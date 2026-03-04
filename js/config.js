// 配置检测模块
const config = {
    // 检测当前运行环境
    detectEnvironment() {
        const hostname = window.location.hostname;
        const port = window.location.port;
        const protocol = window.location.protocol;
        
        // 本地开发环境（直接访问后端开发服务器）
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return {
                isLocal: true,
                isDocker: false,
                apiBaseUrl: `${protocol}//${hostname}${port ? ':' + port : ''}/api`
            };
        }
        
        // 生产环境（单端口模式，API 和前端使用相同地址）
        const portSuffix = port ? `:${port}` : '';
        return {
            isLocal: false,
            isDocker: true,
            apiBaseUrl: `${protocol}//${hostname}${portSuffix}/api`
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
