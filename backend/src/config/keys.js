const fs = require('fs');
const { getEnvPath, getDataDir } = require('../utils/env');

/**
 * 从 .env 文件加载环境变量（仅当环境变量为空/未设置时填充，避免覆盖显式配置）。
 * 注意：使用 falsy 判断而非 hasOwnProperty 判断，
 * 这样 docker-compose 传入空字符串（${JWT_SECRET:-}）时不会遮蔽 setup.js 生成的随机密钥。
 */
function loadEnvVariables() {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    // 去除首尾引号，兼容常见 .env 写法
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 仅在环境变量为空或未设置时使用 .env 的值，
    // 保证显式设置的环境变量优先，同时空值不会遮蔽 .env 中的随机密钥
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

// 已知的公开占位/弱密钥值，部署时若检测到将拒绝启动
const WEAK_SECRET_VALUES = new Set([
  'change-me-in-production',
  'changeme',
  'change_me',
  'secret',
  'your-secret-key',
  'jwt-secret',
  'jwt_secret',
  'please-change-me',
  'password',
  '123456'
]);

const MIN_SECRET_LENGTH = 32;

// 判断密钥是否为弱值（公开占位 / 过短），供启动强校验与 setup.js 复用，
// 保证"setup.js 能修好 keys.js 拒绝启动的密钥"这一闭环
function isWeakSecret(value) {
  if (!value) return true;
  const trimmed = value.trim();
  return WEAK_SECRET_VALUES.has(trimmed.toLowerCase()) || trimmed.length < MIN_SECRET_LENGTH;
}

// 密钥强制校验：缺失/占位值/过短一律拒绝，防止部署即用弱密钥被伪造 JWT
function validateSecret(name, value) {
  if (!value) {
    throw new Error(`[配置错误] ${name} 未设置。请先运行 "node setup.js" 生成随机密钥（保存到 .env），或在部署配置中显式设置强随机 ${name}。`);
  }
  const trimmed = value.trim();
  if (isWeakSecret(trimmed)) {
    throw new Error(`[配置错误] ${name} 使用了公开占位值或密钥过短（< ${MIN_SECRET_LENGTH} 字符），拒绝启动以防 JWT 被伪造。请运行 "node setup.js" 生成随机密钥，或设置强随机 ${name}。`);
  }
  return trimmed;
}

// 获取 JWT 签名密钥
function getJWTSecret() {
  loadEnvVariables();
  return validateSecret('JWT_SECRET', process.env.JWT_SECRET);
}

// 获取刷新令牌签名密钥
function getRefreshTokenSecret() {
  loadEnvVariables();
  return validateSecret('REFRESH_TOKEN_SECRET', process.env.REFRESH_TOKEN_SECRET);
}

function initConfig() {
  loadEnvVariables();

  try {
    getJWTSecret();
    getRefreshTokenSecret();
    console.log('✅ 密钥配置验证通过');
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
  if (process.env.REFRESH_TOKEN_EXPIRE) {
    console.warn(`[配置警告] REFRESH_TOKEN_EXPIRE 格式无效: "${process.env.REFRESH_TOKEN_EXPIRE}"，仅支持数字+d/h (如 7d, 168h)，已使用默认值 7 天。`);
  }
  return 7;
}

module.exports = {
  getJWTSecret,
  getRefreshTokenSecret,
  getRefreshTokenExpireDays,
  getDataDir,
  initConfig,
  WEAK_SECRET_VALUES,
  MIN_SECRET_LENGTH,
  isWeakSecret
};
