#!/usr/bin/env node

/**
 * Timetrace 项目初始化和启动脚本
 * 
 * 功能：
 * 1. 检查并创建.env文件（如果不存在）
 * 2. 生成安全的JWT密钥
 * 3. 创建必要的数据目录
 * 4. 启动前端和后端服务
 * 
 * 使用方法：
 * node setup.js [选项]
 * 
 * 选项：
 * --init-only  仅初始化环境，不启动服务
 * --no-keys    不生成新密钥（如果.env已存在）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// 颜色输出函数
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function colorLog(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 检查命令行参数
const args = process.argv.slice(2);
const initOnly = args.includes('--init-only');
const noKeys = args.includes('--no-keys');

// 项目根目录
const projectRoot = __dirname;
const envPath = path.join(projectRoot, '.env');
const dataDir = path.join(projectRoot, 'data');

// 默认.env模板
const envTemplate = `# 环境变量配置文件
# 此文件由setup.js自动生成，包含敏感信息，请勿提交到版本控制系统

# 服务器端口
PORT=3000

# JWT密钥配置（自动生成）
JWT_SECRET=
JWT_EXPIRE=15m

# 刷新令牌密钥配置（自动生成）
REFRESH_TOKEN_SECRET=
REFRESH_TOKEN_EXPIRE=7d

# 数据存储目录
DATA_DIR=./data

# MongoDB连接字符串 (如果使用MongoDB而非文件存储)
# MONGODB_URI=mongodb://localhost:27017/calendar-app
`;

// 生成安全的随机密钥
function generateSecureKey() {
  return crypto.randomBytes(64).toString('base64');
}

// 初始化环境
async function initEnvironment() {
  colorLog('\n🚀 初始化 Timetrace 项目环境...', 'cyan');
  
  // 创建数据目录
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    colorLog('✅ 创建数据目录: ./data', 'green');
  } else {
    colorLog('✅ 数据目录已存在: ./data', 'green');
  }
  
  // 检查.env文件
  const envExists = fs.existsSync(envPath);
  
  if (!envExists) {
    colorLog('📝 创建.env文件...', 'yellow');
    fs.writeFileSync(envPath, envTemplate);
    colorLog('✅ .env文件已创建', 'green');
  } else {
    colorLog('✅ .env文件已存在', 'green');
  }
  
  // 生成密钥
  if (!noKeys && (!envExists || !hasValidKeys())) {
    colorLog('🔑 生成安全密钥...', 'yellow');
    
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // 替换空密钥
    envContent = envContent.replace(/JWT_SECRET=/, `JWT_SECRET=${generateSecureKey()}`);
    envContent = envContent.replace(/REFRESH_TOKEN_SECRET=/, `REFRESH_TOKEN_SECRET=${generateSecureKey()}`);
    
    fs.writeFileSync(envPath, envContent);
    colorLog('✅ 安全密钥已生成并保存', 'green');
  } else {
    colorLog('✅ 密钥已配置', 'green');
  }
  
  // 检查依赖
  const backendPackagePath = path.join(projectRoot, 'backend', 'package.json');
  if (!fs.existsSync(backendPackagePath)) {
    colorLog('❌ 错误: 找不到backend/package.json文件', 'red');
    process.exit(1);
  }
  
  const nodeModulesPath = path.join(projectRoot, 'backend', 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    colorLog('📦 安装后端依赖...', 'yellow');
    await runCommand('npm', ['install'], { cwd: path.join(projectRoot, 'backend') });
    colorLog('✅ 后端依赖安装完成', 'green');
  } else {
    colorLog('✅ 后端依赖已安装', 'green');
  }
  
  colorLog('\n🎉 环境初始化完成！', 'green');
}

// 检查是否有有效的密钥
function hasValidKeys() {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const jwtMatch = envContent.match(/JWT_SECRET=(.+)/);
  const refreshMatch = envContent.match(/REFRESH_TOKEN_SECRET=(.+)/);
  
  return jwtMatch && jwtMatch[1] && refreshMatch && refreshMatch[1];
}

// 运行命令
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { 
      stdio: 'inherit',
      ...options 
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`命令执行失败，退出码: ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

// 启动服务
async function startServices() {
  colorLog('\n🚀 启动 Timetrace 服务...', 'cyan');
  
  // 启动后端服务
  colorLog('📡 启动后端服务...', 'yellow');
  const backendProcess = spawn('node', ['src/server.js'], {
    cwd: path.join(projectRoot, 'backend'),
    stdio: 'pipe',
    detached: true
  });
  
  backendProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output.includes('Server running on port')) {
      colorLog('✅ 后端服务已启动', 'green');
    }
  });
  
  backendProcess.stderr.on('data', (data) => {
    colorLog(`后端错误: ${data.toString().trim()}`, 'red');
  });
  
  // 等待后端启动
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 启动前端服务
  colorLog('🌐 启动前端服务...', 'yellow');
  const frontendProcess = spawn('python', ['-m', 'http.server', '8000'], {
    cwd: projectRoot,
    stdio: 'pipe',
    detached: true
  });
  
  frontendProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output.includes('Serving HTTP on')) {
      colorLog('✅ 前端服务已启动', 'green');
    }
  });
  
  frontendProcess.stderr.on('data', (data) => {
    colorLog(`前端错误: ${data.toString().trim()}`, 'red');
  });
  
  // 等待前端启动
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 显示访问信息
  colorLog('\n🎉 服务启动完成！', 'green');
  colorLog('📱 前端地址: http://localhost:8000', 'blue');
  colorLog('🔧 后端地址: http://localhost:3000', 'blue');
  colorLog('\n按 Ctrl+C 停止所有服务', 'yellow');
  
  // 处理退出信号
  process.on('SIGINT', () => {
    colorLog('\n🛑 正在停止服务...', 'yellow');
    
    // 终止子进程
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
      spawn('taskkill', ['/pid', frontendProcess.pid, '/f', '/t']);
    } else {
      process.kill(-backendProcess.pid);
      process.kill(-frontendProcess.pid);
    }
    
    colorLog('✅ 服务已停止', 'green');
    process.exit(0);
  });
  
  // 保持进程运行
  if (process.platform === 'win32') {
    // Windows平台
    backendProcess.unref();
    frontendProcess.unref();
  } else {
    // Unix/Linux平台
    backendProcess.unref();
    frontendProcess.unref();
  }
}

// 主函数
async function main() {
  try {
    colorLog('🌟 Timetrace 项目设置工具', 'bright');
    colorLog('================================', 'cyan');
    
    await initEnvironment();
    
    if (!initOnly) {
      await startServices();
    } else {
      colorLog('\n✅ 环境初始化完成！使用 "node setup.js" 启动服务', 'green');
    }
  } catch (error) {
    colorLog(`\n❌ 错误: ${error.message}`, 'red');
    process.exit(1);
  }
}

// 运行主函数
main();