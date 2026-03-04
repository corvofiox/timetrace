const express = require('express');
const path = require('path');
const cors = require('cors');
const fileDB = require('./models/fileDB');
const { initConfig } = require('./config/keys');
const { cleanExpiredRefreshTokens } = require('./models/database');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// 初始化服务器
const initServer = async () => {
  try {
    // 初始化配置（加载环境变量和验证密钥）
    initConfig();
    
    // 初始化数据库
    await fileDB.init();
  } catch (error) {
    console.error('服务器初始化失败:', error.message);
    process.exit(1);
  }
};

const app = express();

// 信任反向代理
app.set('trust proxy', true);

// Middleware
// 配置CORS以允许前端跨域请求
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [];
    
    if (allowedOrigins.length === 0) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error('CORS policy violation: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Content Security Policy middleware
app.use((req, res, next) => {
  const allowedHosts = process.env.CSP_ALLOWED_HOSTS 
    ? process.env.CSP_ALLOWED_HOSTS.split(',').map(h => h.trim())
    : [];
  
  const host = req.get('host');
  const hostname = host ? host.split(':')[0] : 'localhost';
  const protocol = req.protocol;
  
  let connectSrc;
  if (allowedHosts.length > 0) {
    connectSrc = allowedHosts.map(h => `${protocol}://${h} wss://${h} http://${h} ws://${h}`).join(' ');
  } else {
    connectSrc = `'self'`;
  }
  
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; ` +
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'; ` +
    `style-src 'self' 'unsafe-inline'; ` +
    `img-src 'self' data:; ` +
    `font-src 'self'; ` +
    `connect-src ${connectSrc}; ` +
    `frame-src 'none'; ` +
    `object-src 'none'; ` +
    `base-uri 'self'; ` +
    `form-action 'self';`
  );
  next();
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/days', require('./routes/days'));

// 静态文件服务（单端口模式）
// 确定静态文件根目录
const getStaticRoot = () => {
  // __dirname = backend/src
  // 静态文件在项目根目录: index.html, js/, styles/, libs/
  // 开发环境: backend/src -> ../../ -> 项目根目录
  // 生产环境(Docker): /app/backend/src -> ../../ -> /app
  return path.join(__dirname, '../../');
};

// 静态文件路由
app.use(express.static(getStaticRoot(), {
  index: false
}));

// SPA 回退路由 - 所有非 API 请求返回 index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(getStaticRoot(), 'index.html'));
});

// 404 处理（仅 API 路由）
app.use('/api/*', notFoundHandler);

// 全局错误处理
app.use(errorHandler);

// 调试端点 - 检查环境变量（仅用于调试，生产环境中应删除）
if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEBUG_ENDPOINTS === 'true') {
  app.get('/debug/env', (req, res) => {
    res.status(200).json({
      JWT_SECRET_EXISTS: !!process.env.JWT_SECRET,
      JWT_SECRET_LENGTH: process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0,
      REFRESH_TOKEN_SECRET_EXISTS: !!process.env.REFRESH_TOKEN_SECRET,
      REFRESH_TOKEN_SECRET_LENGTH: process.env.REFRESH_TOKEN_SECRET ? process.env.REFRESH_TOKEN_SECRET.length : 0,
      NODE_ENV: process.env.NODE_ENV,
      DOCKER_ENV: process.env.DOCKER_ENV,
      DATA_DIR: process.env.DATA_DIR
    });
  });
}

const PORT = process.env.PORT || 8000;

// 启动服务器
const startServer = async () => {
  await initServer();
  
  // 启动定时清理过期令牌任务（每天凌晨执行）
  const scheduleTokenCleanup = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow - now;
    
    setTimeout(async () => {
      try {
        const deletedCount = await cleanExpiredRefreshTokens(7);
        if (deletedCount > 0) {
          console.log(`已清理 ${deletedCount} 个过期的刷新令牌`);
        }
      } catch (error) {
        console.error('清理过期令牌失败:', error.message);
      }
      
      // 设置下一次清理
      scheduleTokenCleanup();
    }, msUntilMidnight);
  };
  
  // 启动定时清理任务
  scheduleTokenCleanup();
  
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Static files served from: ${getStaticRoot()}`);
  });
};

startServer();
