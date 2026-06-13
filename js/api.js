// API服务模块
const api = {
    baseURL: window.appConfig ? window.appConfig.getApiBaseUrl() : 'http://localhost:3000/api',
    
    // 跨标签页刷新协调
    _refreshChannel: null,
    _getRefreshChannel() {
        if (!this._refreshChannel) {
            this._refreshChannel = new BroadcastChannel('timetrace-token-refresh');
            this._refreshChannel.onmessage = (event) => {
                const { token, refreshToken } = event.data;
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
            channel.postMessage({ token, refreshToken });
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
                    const retryResponse = await fetch(url, {
                        ...options,
                        headers
                    });
                    
                    if (!retryResponse.ok) {
                        const error = await this.parseErrorResponse(retryResponse);
                        throw error;
                    }
                    
                    return await this.parseJsonResponse(retryResponse);
                }
            } catch (refreshError) {
                console.error('[API] 刷新令牌失败:', refreshError);
                this.removeTokens();
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
        
        // 跨标签页协调：检查是否有其他标签页正在刷新
        const lockKey = '_tokenRefreshLock';
        const lockTime = localStorage.getItem(lockKey);
        if (lockTime) {
            const elapsed = Date.now() - parseInt(lockTime, 10);
            if (elapsed < 10000) {
                // 另一个标签页正在刷新，等待其结果
                return this._waitForCrossTabRefresh();
            }
            // 锁过期，清除
            localStorage.removeItem(lockKey);
        }
        
        // 获取跨标签页锁
        this._safeSetItem(lockKey, String(Date.now()));
        
        this._refreshPromise = (async () => {
          try {
            const response = await fetch(`${this.baseURL}/auth/refresh`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ refreshToken })
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
            console.error('[API] 刷新令牌失败:', error);
            throw error;
          } finally {
            this._refreshPromise = null;
            localStorage.removeItem(lockKey);
          }
        })();

        return this._refreshPromise;
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
            return await api.request('/days/', {
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
