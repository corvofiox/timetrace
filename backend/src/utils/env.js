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
  return path.join(getProjectRoot(), '.env');
}

module.exports = {
  isDockerEnvironment,
  getDataDir,
  getProjectRoot,
  getEnvPath
};
