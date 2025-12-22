const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 统一的环境检测
function isDockerEnvironment() {
  // 检查 /.dockerenv 文件是否存在，这是最可靠的Docker环境检测方法
  return fs.existsSync('/.dockerenv');
}

// 统一的.env文件路径解析
function getEnvPath() {
  if (isDockerEnvironment()) {
    // Docker环境中，.env文件在数据目录中
    return '/app/data/.env';
  }
  
  // 在本地环境中，.env文件也在数据目录中
  // 使用相对路径，避免循环依赖
  return path.join(__dirname, '..', 'data', '.env');
}

// 加载环境变量
function loadEnvVariables() {
  const envPath = getEnvPath();
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

// 获取JWT密钥
function getJWTSecret() {
  if (!process.env.JWT_SECRET) {
    loadEnvVariables();
  }
  
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET环境变量未设置');
  }
  
  return process.env.JWT_SECRET;
}

// 获取刷新令牌密钥
function getRefreshTokenSecret() {
  if (!process.env.REFRESH_TOKEN_SECRET) {
    loadEnvVariables();
  }
  
  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new Error('REFRESH_TOKEN_SECRET环境变量未设置');
  }
  
  return process.env.REFRESH_TOKEN_SECRET;
}

// 获取数据目录路径
function getDataDir() {
  // 如果环境变量中已设置DATA_DIR，则使用它
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  
  // 根据环境自动选择默认路径
  if (isDockerEnvironment()) {
    // Docker环境中的默认路径
    return '/app/data';
  } else {
    // 本地开发环境中的默认路径
    return path.join(__dirname, '..', 'data');
  }
}

// 初始化配置
function initConfig() {
  loadEnvVariables();
  
  // 验证必要的密钥是否存在
  try {
    getJWTSecret();
    getRefreshTokenSecret();
    console.log('✅ 密钥配置验证成功');
  } catch (error) {
    console.error('❌ 密钥配置验证失败:', error.message);
    throw error;
  }
}

module.exports = {
  isDockerEnvironment,
  getEnvPath,
  loadEnvVariables,
  getJWTSecret,
  getRefreshTokenSecret,
  getDataDir,
  initConfig
};