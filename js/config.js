// 配置检测模块
const config = {
    // 检测当前运行环境
    detectEnvironment() {
        const hostname = window.location.hostname;
        const port = window.location.port;
        
        // 本地开发环境
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return {
                isLocal: true,
                isDocker: false,
                apiBaseUrl: 'http://localhost:3000/api'
            };
        }
        
        // Docker容器内环境（前端和后端在同一容器中）
        if (port === '8000') {
            return {
                isLocal: false,
                isDocker: true,
                apiBaseUrl: `http://${hostname}:3000/api`
            };
        }
        
        // 其他生产环境
        return {
            isLocal: false,
            isDocker: false,
            apiBaseUrl: `http://${hostname}:3000/api`
        };
    },
    
    // 获取API基础URL
    getApiBaseUrl() {
        const env = this.detectEnvironment();
        return env.apiBaseUrl;
    }
};

// 导出配置
window.appConfig = config;