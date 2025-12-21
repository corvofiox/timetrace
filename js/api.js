// API服务模块
const api = {
    // API基础URL
    baseURL: 'http://localhost:3000/api',
    
    // 获取认证token
    getToken() {
        return localStorage.getItem('token');
    },
    
    // 设置认证token
    setToken(token) {
        localStorage.setItem('token', token);
    },
    
    // 设置刷新令牌
    setRefreshToken(refreshToken) {
        localStorage.setItem('refreshToken', refreshToken);
    },
    
    // 获取刷新令牌
    getRefreshToken() {
        return localStorage.getItem('refreshToken');
    },
    
    // 移除认证token
    removeToken() {
        localStorage.removeItem('token');
    },
    
    // 移除刷新令牌
    removeRefreshToken() {
        localStorage.removeItem('refreshToken');
    },
    
    // 移除所有令牌
    removeTokens() {
        this.removeToken();
        this.removeRefreshToken();
    },
    
    // 通用请求方法
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const token = this.getToken();
        
        // 设置请求头
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        // 如果有token，添加到请求头
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        
        // 发送请求
        const response = await fetch(url, {
            ...options,
            headers
        });
        
        // 处理401未授权错误（可能是令牌过期）
        if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
            try {
                // 尝试使用刷新令牌获取新的访问令牌
                const newToken = await this.refreshAccessToken();
                if (newToken) {
                    // 使用新令牌重新发送请求
                    headers.Authorization = `Bearer ${newToken}`;
                    const retryResponse = await fetch(url, {
                        ...options,
                        headers
                    });
                    
                    if (!retryResponse.ok) {
                        // 尝试解析错误响应，但如果响应体为空则使用默认错误消息
                        let errorMessage = '请求失败';
                        try {
                            const contentType = retryResponse.headers.get('content-type');
                            if (contentType && contentType.includes('application/json')) {
                                const error = await retryResponse.json();
                                errorMessage = error.message || errorMessage;
                            }
                        } catch (e) {
                            // 如果解析JSON失败，使用默认错误消息
                        }
                        throw new Error(errorMessage);
                    }
                    
                    // 尝试解析成功响应，但如果响应体为空则返回null
                    const contentType = retryResponse.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        return await retryResponse.json();
                    } else {
                        return null;
                    }
                }
            } catch (refreshError) {
                // 刷新令牌也过期或无效，需要重新登录
                this.removeTokens();
                window.location.href = '/login.html';
                throw new Error('会话已过期，请重新登录');
            }
        }
        
        // 处理其他错误
        if (!response.ok) {
            // 尝试解析错误响应，但如果响应体为空则使用默认错误消息
            let errorMessage = '请求失败';
            try {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const error = await response.json();
                    errorMessage = error.message || errorMessage;
                }
            } catch (e) {
                // 如果解析JSON失败，使用默认错误消息
            }
            throw new Error(errorMessage);
        }
        
        // 尝试解析成功响应，但如果响应体为空则返回null
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return null;
        }
    },
    
    // 刷新访问令牌
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
                throw new Error('刷新令牌无效');
            }
            
            const data = await response.json();
            this.setToken(data.token);
            return data.token;
        } catch (error) {
            throw new Error('刷新令牌失败: ' + error.message);
        }
    },
    
    // 认证相关API
    // 用户注册
    async register(userData) {
        const response = await api.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
        
        // 保存token和刷新令牌
        if (response.token) {
            api.setToken(response.token);
        }
        
        if (response.refreshToken) {
            api.setRefreshToken(response.refreshToken);
        }
        
        return response;
    },
    
    // 用户登录
    async login(credentials) {
        const response = await api.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials)
        });
        
        // 保存token和刷新令牌
        if (response.token) {
            api.setToken(response.token);
        }
        
        if (response.refreshToken) {
            api.setRefreshToken(response.refreshToken);
        }
        
        return response;
    },
    
    // 获取当前用户信息
    async getMe() {
        return await this.request('/auth/me');
    },
    
    // 登出
    async logout() {
        try {
            const refreshToken = this.getRefreshToken();
            await this.request('/auth/logout', {
                method: 'POST',
                body: JSON.stringify({ refreshToken })
            });
        } catch (error) {
            // 请求失败，但finally块会处理清理工作
        } finally {
            // 无论请求是否成功，都清除本地令牌
            this.removeTokens();
        }
    },
    
    // 目标相关API
    async getGoals() {
        return await this.goals.getAll();
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
    
    // 日计划相关API
    async getDays(startDate, endDate) {
        return await this.days.getAll(startDate, endDate);
    },
    
    async getDayByDate(date) {
        return await this.days.getByDate(date);
    },
    
    async createOrUpdateDay(dayData) {
        return await this.days.createOrUpdate(dayData);
    },
    
    // 搜索备注
    async searchNotes(searchParams) {
        return await this.days.searchNotes(searchParams);
    },
    
    // 嵌套对象保持兼容性
    auth: {
        // 用户注册
        async register(userData) {
            const response = await api.request('/auth/register', {
                method: 'POST',
                body: JSON.stringify(userData)
            });
            
            // 保存token和刷新令牌
            if (response.token) {
                api.setToken(response.token);
            }
            
            if (response.refreshToken) {
                api.setRefreshToken(response.refreshToken);
            }
            
            return response;
        },
        
        // 用户登录
        async login(credentials) {
            const response = await api.request('/auth/login', {
                method: 'POST',
                body: JSON.stringify(credentials)
            });
            
            // 保存token和刷新令牌
            if (response.token) {
                api.setToken(response.token);
            }
            
            if (response.refreshToken) {
                api.setRefreshToken(response.refreshToken);
            }
            
            return response;
        },
        
        // 获取当前用户信息
        async getMe() {
            return await api.request('/auth/me');
        },
        
        // 登出
        async logout() {
            try {
                const refreshToken = api.getRefreshToken();
                await api.request('/auth/logout', {
                    method: 'POST',
                    body: JSON.stringify({ refreshToken })
                });
            } catch (error) {
                // 请求失败，但finally块会处理清理工作
            } finally {
                // 无论请求是否成功，都清除本地令牌
                api.removeTokens();
            }
        }
    },
    
    // 目标相关API
    goals: {
        // 获取所有目标
        async getAll() {
            return await api.request('/goals');
        },
        
        // 获取单个目标
        async getById(id) {
            return await api.request(`/goals/${id}`);
        },
        
        // 创建新目标
        async create(goalData) {
            return await api.request('/goals', {
                method: 'POST',
                body: JSON.stringify(goalData)
            });
        },
        
        // 更新目标
        async update(id, goalData) {
            return await api.request(`/goals/${id}`, {
                method: 'PUT',
                body: JSON.stringify(goalData)
            });
        },
        
        // 删除目标
        async delete(id) {
            return await api.request(`/goals/${id}`, {
                method: 'DELETE'
            });
        },
        
        // 更新目标顺序
        async updateOrder(goalIds) {
            return await api.request('/goals/reorder', {
                method: 'PUT',
                body: JSON.stringify({ goalIds })
            });
        }
    },
    
    // 日计划相关API
    days: {
        // 获取所有日计划
        async getAll(startDate, endDate) {
            let query = '';
            if (startDate && endDate) {
                query = `?startDate=${startDate}&endDate=${endDate}`;
            }
            return await api.request(`/days/${query}`);
        },
        
        // 根据日期获取日计划
        async getByDate(date) {
            return await api.request(`/days/date/${date}`);
        },
        
        // 创建或更新日计划
        async createOrUpdate(dayData) {
            return await api.request('/days/', {
                method: 'POST',
                body: JSON.stringify(dayData)
            });
        },
        
        // 搜索备注
        async searchNotes(searchParams) {
            const { keyword } = searchParams;
            const query = `?keyword=${encodeURIComponent(keyword)}`;
            
            return await api.request(`/days/search${query}`);
        }
    }
};