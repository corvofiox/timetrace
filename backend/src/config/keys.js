const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { isDockerEnvironment, getEnvPath, getDataDir } = require('../utils/env');

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

function initConfig() {
  loadEnvVariables();
  
  try {
    getJWTSecret();
    getRefreshTokenSecret();
    console.log('✅ 密钥配置验证成功');
  } catch (error) {
    console.error('❌ 密钥配置验证失败:', error.message);
    throw error;
  }
}

function getRefreshTokenExpireDays() {
  const expire = process.env.REFRESH_TOKEN_EXPIRE || '7d';
  const match = expire.match(/^(\d+)([dh])$/i);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 'd') return value;
    if (unit === 'h') return Math.ceil(value / 24);
  }
  return 7;
}

module.exports = {
  loadEnvVariables,
  getJWTSecret,
  getRefreshTokenSecret,
  getRefreshTokenExpireDays,
  getDataDir,
  initConfig
};