const express = require('express');
const cors = require('cors');
const fileDB = require('./models/fileDB');
const { initConfig } = require('./config/keys');

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

// Middleware
// 配置CORS以允许前端跨域请求
app.use(cors({
  origin: (origin, callback) => {
    // 允许没有origin的请求（如移动应用、Postman等）
    if (!origin) return callback(null, true);
    
    // 在生产环境中，可以在这里添加允许的域名白名单
    // 目前允许所有来源，适用于Docker容器内的前端
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Content Security Policy middleware
app.use((req, res, next) => {
  // 动态获取当前主机名
  const host = req.get('host');
  const hostname = host ? host.split(':')[0] : 'localhost';
  
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    `font-src 'self'; ` +
    `connect-src 'self' http://${hostname}:3000 ws://${hostname}:3000; ` +
    "frame-src 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );
  next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/days', require('./routes/days'));

// 调试端点 - 检查环境变量（仅用于调试，生产环境中应删除）
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

const PORT = process.env.PORT || 3000;

// 启动服务器
const startServer = async () => {
  await initServer();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();