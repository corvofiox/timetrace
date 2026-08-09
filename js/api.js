// API服务模块
const api = {
    baseURL: window.appConfig ? window.appConfig.getApiBaseUrl() : 'http://localhost:8192/api',
    
    // 跨标签页刷新协调
    _refreshChannel: null,
    // 当前标签页登录用户 id（可能未加载完成时为 null）：
    // 广播令牌时携带、接收时校验，防止登出标签页被其他账号的轮换广播写入令牌（R2F-7）
    _getLocalUserId() {
        try {
            if (typeof appData !== 'undefined' && appData.user && appData.user.id !== undefined && appData.user.id !== null) {
                return appData.user.id;
            }
        } catch (e) {
            // app.js 尚未加载完成时忽略
        }
        return null;
    },
    _getRefreshChannel() {
        if (!this._refreshChannel) {
            this._refreshChannel = new BroadcastChannel('timetrace-token-refresh');
            this._refreshChannel.onmessage = (event) => {
                const { token, refreshToken, userId } = event.data || {};
                // R2F-7: 令牌广播按用户作用域隔离——仅当发送方 userId 与本地当前
                // 登录用户一致时才写入。本地未登录（无 userId）或用户不同一律拒绝：
                // 否则标签页 A 登出后，B 的 token 轮换广播会把 B 的 token 写入 A 的
                // localStorage，A 刷新即以 B 身份登录。
                const localUserId = this._getLocalUserId();
                if (localUserId === null || String(localUserId) !== String(userId)) {
                    return;
                }
                if (token) {
                    this._safeSetItem('token', token);
                }
                if (refreshToken) {
                    this._safeSetItem('refreshToken', refreshToken);
                }
            };
        }
        return this._refreshChannel;
    },
    _broadcastTokens(token, refreshToken) {
        try {
            const channel = this._getRefreshChannel();
            channel.postMessage({ token, refreshToken, userId: this._getLocalUserId() });
        } catch (e) {
            // BroadcastChannel not supported — fall back to polling
        }
    },
    
    _safeSetItem(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.error('[API] localStorage 配额已满:', key);
            } else {
                throw e;
            }
        }
    },
    
    getToken() {
        return localStorage.getItem('token');
    },
    
    setToken(token) {
        this._safeSetItem('token', token);
    },
    
    setRefreshToken(refreshToken) {
        this._safeSetItem('refreshToken', refreshToken);
    },
    
    getRefreshToken() {
        return localStorage.getItem('refreshToken');
    },
    
    removeToken() {
        localStorage.removeItem('token');
    },
    
    removeRefreshToken() {
        localStorage.removeItem('refreshToken');
    },
    
    removeTokens() {
        this.removeToken();
        this.removeRefreshToken();
    },
    
    async parseJsonResponse(response) {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            return null;
        }

        try {
            return await response.json();
        } catch (error) {
            console.error('[API] JSON解析失败:', error.message);
            return null;
        }
    },
    
    async parseErrorResponse(response) {
        try {
            const data = await this.parseJsonResponse(response);
            if (data && (data.errorCode || data.message)) {
                return {
                    success: false,
                    errorCode: data.errorCode || 'UNKNOWN_001',
                    message: data.message || '请求失败',
                    details: data.details || null,
                    statusCode: response.status
                };
            }
        } catch (e) {
            console.error('[API] 解析错误响应失败:', e);
        }
        
        const statusMessages = {
            400: '请求参数错误',
            401: '未授权，请重新登录',
            403: '没有权限访问此资源',
            404: '请求的资源不存在',
            409: '资源冲突',
            413: '请求体过大',
            429: '请求过于频繁，请稍后重试',
            500: '服务器内部错误',
            502: '网关错误',
            503: '服务暂时不可用',
            504: '网关超时'
        };
        
        return {
            success: false,
            errorCode: 'HTTP_' + response.status,
            message: statusMessages[response.status] || `请求失败 (${response.status})`,
            details: null,
            statusCode: response.status
        };
    },
    
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const token = this.getToken();
        
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        
        let response;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        try {
            response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal
            });
        } catch (networkError) {
            console.error('[API] 网络错误:', networkError);
            if (networkError.name === 'AbortError') {
                const error = {
                    success: false,
                    errorCode: 'TIMEOUT',
                    message: '请求超时，请检查网络连接后重试',
                    details: null
                };
                throw error;
            }
            const error = {
                success: false,
                errorCode: 'NETWORK_ERROR',
                message: '网络连接失败，请检查网络设置',
                details: { originalError: networkError.message }
            };
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
        
        if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
            try {
                const newToken = await this.refreshAccessToken();
                if (newToken) {
                    headers.Authorization = `Bearer ${newToken}`;
                    const retryController = new AbortController();
                    const retryTimeoutId = setTimeout(() => retryController.abort(), 30000);
                    try {
                        const retryResponse = await fetch(url, {
                            ...options,
                            headers,
                            signal: retryController.signal
                        });

                        if (!retryResponse.ok) {
                            const error = await this.parseErrorResponse(retryResponse);
                            throw error;
                        }

                        return await this.parseJsonResponse(retryResponse);
                    } finally {
                        clearTimeout(retryTimeoutId);
                    }
                }
            } catch (refreshError) {
                console.error('[API] 刷新令牌失败:', refreshError);
                // 网络瞬时错误（fetch 失败/超时）：不删令牌、不强制登出，抛可重试的网络错误；
                // 仅当 refresh 请求确认失败（HTTP 401/无效令牌）时才清理令牌并登出
                if (refreshError && (
                    refreshError.errorCode === 'NETWORK_ERROR' ||
                    refreshError.errorCode === 'TIMEOUT' ||
                    refreshError instanceof TypeError ||
                    (refreshError.message && (
                        refreshError.message.includes('Failed to fetch') ||
                        refreshError.message.toLowerCase().includes('network')
                    ))
                )) {
                    const error = {
                        success: false,
                        errorCode: 'NETWORK_ERROR',
                        message: '网络连接失败，请检查网络设置',
                        details: { originalError: refreshError.message || refreshError.errorCode }
                    };
                    throw error;
                }
                this.removeTokens();
                // R2F-2: 强制登出与 handleLogout 行为对称——通知 app.js 递增 sessionEpoch
                // 并清空 pending/reorderQueue/daySaveQueue，防止旧账号的排队编辑/残留队列
                // 串入下一个登录账号（仅切 DOM 会导致换账号后旧 pending 渲染进新账号）
                try {
                    window.dispatchEvent(new CustomEvent('auth:force-logout'));
                } catch (e) {
                    // 事件派发失败不影响强制登出本身
                }
                this.showLoginScreen();
                const error = {
                    success: false,
                    errorCode: 'AUTH_002',
                    message: '会话已过期，请重新登录',
                    details: null
                };
                throw error;
            }
        }
        
        if (!response.ok) {
            const error = await this.parseErrorResponse(response);
            console.error(`[API] 请求失败 [${endpoint}]:`, error);
            throw error;
        }
        
        return await this.parseJsonResponse(response);
    },
    
    _refreshPromise: null,
    
    showLoginScreen() {
        const authContainer = document.getElementById('auth-container');
        const appContainer = document.getElementById('app-container');
        if (authContainer && appContainer) {
            authContainer.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    },
    
    async refreshAccessToken() {
        // 防止并发 401 触发多次刷新（单标签页内）
        if (this._refreshPromise) {
            return this._refreshPromise;
        }

        const refreshToken = this.getRefreshToken();
        if (!refreshToken) {
            throw new Error('没有刷新令牌');
        }
        
        // 跨标签页协调：优先使用 Web Locks API 实现原子互斥
        // （localStorage 的 get+set 非原子是双标签页并发刷新的根源）
        if (navigator.locks && typeof navigator.locks.request === 'function') {
            const tokenBeforeLock = this.getToken();
            try {
                return await navigator.locks.request('timetrace-token-refresh', { timeout: 15000 }, async () => {
                    // 清理旧流程可能遗留的 localStorage 锁标记
                    localStorage.removeItem('_tokenRefreshLock');
                    // 等待期间其他标签页可能已完成刷新（token 已变化）：直接复用
                    const tokenAfterLock = this.getToken();
                    if (tokenAfterLock && tokenAfterLock !== tokenBeforeLock) {
                        return tokenAfterLock;
                    }
                    return this._doRefreshWithRetry(this.getRefreshToken());
                });
            } catch (lockError) {
                // 等待锁超时/被中断（DOMException TimeoutError/AbortError）：属于可恢复错误，
                // 归类为 TIMEOUT 抛出，上层按网络错误处理（不删令牌、不登出）。
                // 若不加此归类，会走 removeTokens+登出，清掉共享 token 影响持锁标签页（C-28）
                if ((typeof DOMException !== 'undefined' && lockError instanceof DOMException) ||
                    lockError.name === 'TimeoutError' ||
                    lockError.name === 'AbortError') {
                    throw {
                        success: false,
                        errorCode: 'TIMEOUT',
                        message: '刷新令牌等待超时，请重试',
                        details: { originalError: lockError.message || lockError.name }
                    };
                }
                // 锁回调内部的结构化错误（NETWORK_ERROR/AUTH_002 等）原样上抛
                throw lockError;
            }
        }
        
        // 旧路径（无 Web Locks）：localStorage 锁 + 等待 + 兜底自刷新
        const lockKey = '_tokenRefreshLock';
        const lockTime = localStorage.getItem(lockKey);
        if (lockTime) {
            const elapsed = Date.now() - parseInt(lockTime, 10);
            if (elapsed < 10000) {
                try {
                    // 另一个标签页正在刷新，等待其结果
                    return await this._waitForCrossTabRefresh();
                } catch (waitError) {
                    // 等待超时/锁被清除但令牌未变：不直接登出，
                    // 清除过期锁后自行尝试刷新（是否登出由上层按失败类型决定）
                    console.warn('[API] 跨标签页刷新等待超时，尝试自行刷新:', waitError);
                    localStorage.removeItem(lockKey);
                }
            } else {
                // 锁过期，清除
                localStorage.removeItem(lockKey);
            }
        }
        
        // 获取跨标签页锁
        this._safeSetItem(lockKey, String(Date.now()));
        
        this._refreshPromise = (async () => {
          try {
            return await this._doRefreshWithRetry(refreshToken);
          } catch (error) {
            console.error('[API] 刷新令牌失败:', error);
            throw error;
          } finally {
            this._refreshPromise = null;
            localStorage.removeItem(lockKey);
          }
        })();

        return this._refreshPromise;
    },
    
    // 刷新令牌请求（带 30s 超时；网络错误抛结构化 NETWORK_ERROR/TIMEOUT，不删令牌）
    async _doRefreshRequest(refreshToken) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(`${this.baseURL}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refreshToken }),
                signal: controller.signal
            });
            
            if (!response.ok) {
                const error = await this.parseErrorResponse(response);
                throw error;
            }
            
            const data = await response.json();
            this.setToken(data.token);
            if (data.refreshToken) {
                this.setRefreshToken(data.refreshToken);
            }
            
            // 通知其他标签页新令牌
            this._broadcastTokens(data.token, data.refreshToken);
            
            return data.token;
        } catch (error) {
            if (error && (error.name === 'AbortError' || error.errorCode === 'TIMEOUT')) {
                throw {
                    success: false,
                    errorCode: 'TIMEOUT',
                    message: '请求超时，请检查网络连接后重试',
                    details: null
                };
            }
            // 未结构化的 fetch 网络错误 → 包装为 NETWORK_ERROR（结构化错误原样抛出）
            if (error && !error.errorCode) {
                throw {
                    success: false,
                    errorCode: 'NETWORK_ERROR',
                    message: '网络连接失败，请检查网络设置',
                    details: { originalError: error.message || String(error) }
                };
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    },
    
    // 是否认证类失败（refreshToken 无效/过期 → HTTP 401）
    _isAuthFailure(error) {
        if (!error) return false;
        if (error.statusCode === 401) return true;
        if (error.errorCode && (String(error.errorCode).startsWith('AUTH_') || String(error.errorCode).startsWith('LOGIN_'))) return true;
        if (error.message && /401|未授权|会话已过期|invalid.*refresh|refresh.*invalid/i.test(error.message)) return true;
        return false;
    },
    
    // 刷新并允许一次额外重试：令牌刚被其他标签页轮换时，用本地最新 refreshToken 再试一次
    async _doRefreshWithRetry(initialRefreshToken) {
        let refreshToken = initialRefreshToken;
        let attempts = 0;
        const maxAttempts = 2;
        while (attempts < maxAttempts) {
            attempts++;
            try {
                return await this._doRefreshRequest(refreshToken);
            } catch (error) {
                const isAuthFailure = this._isAuthFailure(error);
                const currentToken = this.getRefreshToken();
                const tokenRotated = currentToken && currentToken !== refreshToken;
                if (attempts < maxAttempts && isAuthFailure && tokenRotated) {
                    refreshToken = currentToken;
                    continue;
                }
                throw error;
            }
        }
        throw new Error('刷新令牌失败');
    },
    
    _waitForCrossTabRefresh() {
        const startTime = Date.now();
        const maxWait = 8000; // 最多等待 8 秒
        const savedToken = this.getToken();
        
        return new Promise((resolve, reject) => {
            const check = setInterval(() => {
                const newToken = this.getToken();
                // 如果令牌已刷新（不同于之前的值），则使用新令牌
                if (newToken && newToken !== savedToken) {
                    clearInterval(check);
                    resolve(newToken);
                    return;
                }
                // 超时或锁被清除（刷新失败）
                const lockTime = localStorage.getItem('_tokenRefreshLock');
                if (Date.now() - startTime > maxWait || !lockTime) {
                    clearInterval(check);
                    if (newToken && newToken !== savedToken) {
                        resolve(newToken);
                    } else {
                        reject(new Error('令牌刷新超时'));
                    }
                }
            }, 200);
        });
    },
    
    auth: {
        async register(userData) {
            const response = await api.request('/auth/register', {
                method: 'POST',
                body: JSON.stringify(userData)
            });
            
            if (response && response.token) {
                api.setToken(response.token);
            }
            
            if (response && response.refreshToken) {
                api.setRefreshToken(response.refreshToken);
            }
            
            return response;
        },
        
        async login(credentials) {
            const response = await api.request('/auth/login', {
                method: 'POST',
                body: JSON.stringify(credentials)
            });
            
            if (response && response.token) {
                api.setToken(response.token);
            }
            
            if (response && response.refreshToken) {
                api.setRefreshToken(response.refreshToken);
            }
            
            return response;
        },
        
        async getMe() {
            return await api.request('/auth/me');
        },
        
        async logout() {
            try {
                const refreshToken = api.getRefreshToken();
                await api.request('/auth/logout', {
                    method: 'POST',
                    body: JSON.stringify({ refreshToken })
                });
            } catch (error) {
                console.warn('[API] 登出请求失败，继续清理本地令牌:', error);
            } finally {
                api.removeTokens();
            }
        }
    },
    
    goals: {
        async getAll() {
            return await api.request('/goals');
        },
        
        async getById(id) {
            return await api.request(`/goals/${id}`);
        },
        
        async create(goalData) {
            return await api.request('/goals', {
                method: 'POST',
                body: JSON.stringify(goalData)
            });
        },
        
        async update(id, goalData) {
            return await api.request(`/goals/${id}`, {
                method: 'PUT',
                body: JSON.stringify(goalData)
            });
        },
        
        async delete(id) {
            return await api.request(`/goals/${id}`, {
                method: 'DELETE'
            });
        },
        
        async updateOrder(goalIds) {
            return await api.request('/goals/reorder', {
                method: 'PUT',
                body: JSON.stringify({ goalIds })
            });
        }
    },
    
    days: {
        async getAll(startDate, endDate) {
            let query = '';
            if (startDate && endDate) {
                const params = new URLSearchParams();
                params.append('startDate', startDate);
                params.append('endDate', endDate);
                query = `?${params.toString()}`;
            }
            return await api.request(`/days/${query}`);
        },
        
        async getByDate(date) {
            return await api.request(`/days/date/${date}`);
        },
        
        async createOrUpdate(dayData) {
            return await api.request('/days', {
                method: 'POST',
                body: JSON.stringify(dayData)
            });
        },
        
        async searchNotes(searchParams) {
            const { keyword } = searchParams;
            const params = new URLSearchParams();
            params.append('keyword', keyword);
            const query = `?${params.toString()}`;
            return await api.request(`/days/search${query}`);
        },
        
        async batchUpdate(days) {
            return await api.request('/days/batch', {
                method: 'POST',
                body: JSON.stringify({ days })
            });
        }
    },
    
    async getGoals() {
        return await this.goals.getAll();
    },
    
    async getGoalById(id) {
        return await this.goals.getById(id);
    },
    
    async createGoal(goalData) {
        return await this.goals.create(goalData);
    },
    
    async updateGoal(id, goalData) {
        return await this.goals.update(id, goalData);
    },
    
    async deleteGoal(id) {
        return await this.goals.delete(id);
    },
    
    async updateGoalOrder(goalIds) {
        return await this.goals.updateOrder(goalIds);
    },
    
    async getDays(startDate, endDate) {
        return await this.days.getAll(startDate, endDate);
    },

    async createOrUpdateDay(dayData) {
        return await this.days.createOrUpdate(dayData);
    },
    
    async searchNotes(keyword) {
        return await this.days.searchNotes({ keyword });
    },
    
    async batchUpdateDays(days) {
        return await this.days.batchUpdate(days);
    }
};
