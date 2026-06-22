const express = require('express');
const path = require('path');
const cors = require('cors');
const { initConfig, getRefreshTokenExpireDays } = require('./config/keys');
const { init: initDatabase, cleanup: cleanupDatabase, cleanExpiredRefreshTokens } = require('./models/database');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const rateLimit = require('express-rate-limit');

// 初始化服务器
const initServer = async () => {
  try {
    // 初始化配置（加载环境变量和验证密钥）
    initConfig();
    
    // 初始化数据库（自动迁移 JSON 到 SQLite）
    await initDatabase();
  } catch (error) {
    console.error('服务器初始化失败:', error.message);
    process.exit(1);
  }
};

const app = express();

// 信任反向代理：仅信任本地与私有网络地址，避免 IP 伪造绕过限流
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// Middleware
// 配置CORS以允许前端跨域请求
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : ['http://localhost:8000', 'http://localhost:3000'];

    if (allowedOrigins.includes('*')) {
      // 允许所有来源：动态回显请求 Origin，以兼容 credentials: true
      return callback(null, origin);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn('[CORS拒绝]', {
      origin,
      allowedOrigins,
      envAllowedOrigins: process.env.ALLOWED_ORIGINS
    });
    return callback(new Error('CORS policy violation: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Rate limiting for auth routes (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '请求过于频繁，请稍后重试', errorCode: 'RATE_LIMIT' }
});
app.use('/api/auth', authLimiter);

// General API rate limiter for all /api/* routes (100 req/min per IP)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '请求过于频繁，请稍后重试', errorCode: 'RATE_LIMIT' }
});
app.use('/api', apiLimiter);

// Content Security Policy middleware
app.use((req, res, next) => {
  const allowedHosts = process.env.CSP_ALLOWED_HOSTS 
    ? process.env.CSP_ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(h => h.length > 0)
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
    // script-src: 'unsafe-inline' is required because Chart.js and inline scripts
    // in index.html inject style/script in a way that CSP strict-dynamic/nonce cannot
    // easily accommodate in this vanilla JS SPA served as static files.
    // 'unsafe-eval' has been removed — no eval() usage exists in the codebase.
    `script-src 'self' 'unsafe-inline'; ` +
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

// Debug endpoint — disabled in production by ENABLE_DEBUG_ENDPOINTS guard
// Only accessible when NODE_ENV !== 'production' AND ENABLE_DEBUG_ENDPOINTS === 'true'.
// This endpoint leaks config state (JWT_SECRET configured, DATA_DIR path, etc.)
// and must never be enabled in production.
if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEBUG_ENDPOINTS === 'true') {
  app.get('/debug/env', (req, res) => {
    res.status(200).json({
      JWT_SECRET_CONFIGURED: !!process.env.JWT_SECRET,
      REFRESH_TOKEN_SECRET_CONFIGURED: !!process.env.REFRESH_TOKEN_SECRET,
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
        const deletedCount = await cleanExpiredRefreshTokens(getRefreshTokenExpireDays());
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
  
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Static files served from: ${getStaticRoot()}`);
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    server.close(async () => {
      console.log('HTTP server closed');
      try {
        await cleanupDatabase();
      } catch (err) {
        console.error('Cleanup failed:', err);
      }
      process.exit(0);
    });
    // Force shutdown after 10s
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return server;
};

// 非测试环境自动启动服务器，测试环境由测试文件自行控制
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = { app, startServer };
