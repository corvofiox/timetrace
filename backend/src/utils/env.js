const fs = require('fs');
const path = require('path');

function isDockerEnvironment() {
  if (fs.existsSync('/.dockerenv')) {
    return true;
  }
  if (fs.existsSync('/run/.containerenv')) {
    return true;
  }
  if (process.env.NODE_ENV === 'production' && process.env.DATA_DIR === '/app/data') {
    return true;
  }
  return false;
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

module.exports = {
  isDockerEnvironment,
  getDataDir,
  getProjectRoot,
  getEnvPath
};
