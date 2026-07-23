const fs = require('fs');
const path = require('path');

function isDockerEnvironment() {
  return fs.existsSync('/.dockerenv');
}

function getProjectRoot() {
  if (isDockerEnvironment()) {
    return '/app';
  }
  return path.join(__dirname, '..', '..', '..');
}

function getDataDir() {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  
  if (isDockerEnvironment()) {
    return '/app/data';
  } else {
    return path.join(getProjectRoot(), 'backend', 'src', 'data');
  }
}

function getEnvPath() {
  const dataDir = getDataDir();
  return path.join(dataDir, '.env');
}

/**
 * 从.env文件加载环境变量到 process.env
 * 仅加载 process.env 中尚未定义的变量，支持 export 前缀和引号值
 * @param {string} envPath - .env 文件路径
 */
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    let key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    // 支持 export KEY=VALUE 写法
    if (key.startsWith('export ')) {
      key = key.slice(7).trim();
    }
    // 去除首尾引号，兼容常见 .env 写法
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

module.exports = {
  isDockerEnvironment,
  getDataDir,
  getProjectRoot,
  getEnvPath,
  loadEnvFile
};
