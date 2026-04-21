// API服务模块
const api = {
    baseURL: window.appConfig ? window.appConfig.getApiBaseUrl() : 'http://localhost:3000/api',
    
    getToken() {
        return localStorage.getItem('token');
    },
    
    setToken(token) {
        localStorage.setItem('token', token);
    },
    
    setRefreshToken(refreshToken) {
        localStorage.setItem('refreshToken', refreshToken);
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
        
        const responseText = await response.text();
        
        try {
            return JSON.parse(responseText);
        } catch (error) {
            const trimmedText = responseText.trim();
            const lastBraceIndex = trimmedText.lastIndexOf('}');
            if (lastBraceIndex !== -1) {
                const cleanedText = trimmedText.substring(0, lastBraceIndex + 1);
                return JSON.parse(cleanedText);
            }
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
        try {
            response = await fetch(url, {
                ...options,
                headers
            });
        } catch (networkError) {
            console.error('[API] 网络错误:', networkError);
            const error = {
                success: false,
                errorCode: 'NETWORK_ERROR',
                message: '网络连接失败，请检查网络设置',
                details: { originalError: networkError.message }
            };
            throw error;
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
    
    showLoginScreen() {
        if (typeof elements !== 'undefined' && elements.authContainer && elements.appContainer) {
            elements.authContainer.style.display = 'flex';
            elements.appContainer.style.display = 'none';
        } else {
            const authContainer = document.getElementById('auth-container');
            const appContainer = document.getElementById('app-container');
            if (authContainer && appContainer) {
                authContainer.style.display = 'flex';
                appContainer.style.display = 'none';
            }
        }
    },
    
    async refreshAccessToken() {
        const refreshToken = this.getRefreshToken();
        if (!refreshToken) {
            throw new Error('没有刷新令牌');
        }
        
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
            return data.token;
        } catch (error) {
            console.error('[API] 刷新令牌失败:', error);
            throw error;
        }
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
                query = `?startDate=${startDate}&endDate=${endDate}`;
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
            const query = `?keyword=${encodeURIComponent(keyword)}`;
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
    
    async getDayByDate(date) {
        return await this.days.getByDate(date);
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
