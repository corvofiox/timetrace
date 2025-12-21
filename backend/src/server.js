const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const fileDB = require('./models/fileDB');

// Load environment variables
// 首先尝试从根目录加载.env文件，如果不存在则从当前目录加载
const path = require('path');
const rootEnvPath = path.resolve(__dirname, '../../.env');
const localEnvPath = path.resolve(__dirname, '../.env');
const fs = require('fs');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config({ path: localEnvPath });
}

// 初始化数据库
const initServer = async () => {
  try {
    await fileDB.init();
  } catch (error) {
    process.exit(1);
  }
};

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Content Security Policy middleware
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "connect-src 'self' http://localhost:3000 ws://localhost:3000; " +
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

const PORT = process.env.PORT || 3000;

// 启动服务器
const startServer = async () => {
  await initServer();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();