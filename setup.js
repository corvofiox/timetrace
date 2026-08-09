#!/usr/bin/env node

/**
 * Timetrace 项目初始化和启动脚本
 * 
 * 功能：
 * 1. 检查并创建.env文件（如果不存在）
 * 2. 生成安全的JWT密钥
 * 3. 创建必要的数据目录
 * 4. 启动服务（单端口模式，同时提供 API 和静态文件）
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

const { isDockerEnvironment, getDataDir, getProjectRoot, getEnvPath, loadEnvFile } = require('./backend/src/utils/env');
// 复用 keys.js 的弱密钥判定（WEAK_SECRET_VALUES 占位值 + 最短长度），
// 保证 keys.js 拒绝启动的弱密钥能被 setup.js 重新生成（否则用户按提示操作也无法恢复）
const { isWeakSecret } = require('./backend/src/config/keys');

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

const projectRoot = getProjectRoot();
const dataDir = getDataDir();
const envPath = getEnvPath();

// 默认.env模板
const envTemplate = `# 环境变量配置文件
# 此文件由setup.js自动生成，包含敏感信息，请勿提交到版本控制系统

# 服务器端口
PORT=8192

# JWT密钥配置（自动生成）
JWT_SECRET=
JWT_EXPIRE=15m

# 刷新令牌密钥配置（自动生成）
REFRESH_TOKEN_SECRET=
REFRESH_TOKEN_EXPIRE=7d

# 数据存储目录
DATA_DIR=${dataDir}

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
  colorLog(`项目根目录: ${projectRoot}`, 'cyan');
  colorLog(`数据目录: ${dataDir}`, 'cyan');
  colorLog(`环境文件路径: ${envPath}`, 'cyan');
  
  // 创建数据目录
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    colorLog(`✅ 创建数据目录: ${dataDir}`, 'green');
  } else {
    colorLog(`✅ 数据目录已存在: ${dataDir}`, 'green');
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
  
  // 生成密钥 - 仅重新生成缺失或过弱的密钥（避免只丢一个密钥时把另一个也轮换掉、导致所有已登录会话失效）
  const missingKeys = getMissingKeys();
  if (!noKeys && missingKeys.length > 0) {
    colorLog(`🔑 生成安全密钥 (需重新生成: ${missingKeys.join(', ')})...`, 'yellow');
    
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // 只替换缺失的密钥；正则锚定行首（排除注释行）
    if (missingKeys.includes('JWT_SECRET')) {
      envContent = envContent.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${generateSecureKey()}`);
    }
    if (missingKeys.includes('REFRESH_TOKEN_SECRET')) {
      envContent = envContent.replace(/^REFRESH_TOKEN_SECRET=.*$/m, `REFRESH_TOKEN_SECRET=${generateSecureKey()}`);
    }
    
    // 确保DATA_DIR设置正确
    envContent = envContent.replace(/^DATA_DIR=.*$/m, `DATA_DIR=${dataDir}`);
    
    fs.writeFileSync(envPath, envContent);
    colorLog('✅ 缺失/过弱的安全密钥已生成并保存', 'green');
  } else if (envExists) {
    // 即使不生成新密钥，也确保DATA_DIR设置正确
    let envContent = fs.readFileSync(envPath, 'utf8');
    const dataDirMatch = envContent.match(/^DATA_DIR=(.+)$/m);
    
    if (!dataDirMatch || dataDirMatch[1].trim() !== dataDir) {
      colorLog('📝 更新数据目录路径...', 'yellow');
      envContent = envContent.replace(/^DATA_DIR=.*$/m, `DATA_DIR=${dataDir}`);
      fs.writeFileSync(envPath, envContent);
      colorLog('✅ 数据目录路径已更新', 'green');
    }
    
    colorLog('✅ 密钥已配置', 'green');
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

// 去除 .env 值两侧引号，与 keys.js loadEnvVariables 的解析保持一致
function stripEnvQuotes(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

// 检查 .env 中缺失或过弱的密钥，返回需要重新生成的密钥名列表。
// 复用 keys.js 导出的 isWeakSecret（WEAK_SECRET_VALUES 公开占位值 + 最短长度阈值），
// 与 keys.js 启动强校验完全一致：只补缺失不修弱值时，keys.js 拒绝启动并提示
// "请运行 node setup.js"，但用户照做也无法恢复——这里补齐该死角。
function getMissingKeys() {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const missing = [];
  // 正则锚定行首（^...$/m），不会误匹配 "# JWT_SECRET=xxx" 这类注释行
  const jwtMatch = envContent.match(/^JWT_SECRET=(.+)$/m);
  if (!jwtMatch || isWeakSecret(stripEnvQuotes(jwtMatch[1]))) missing.push('JWT_SECRET');
  const refreshMatch = envContent.match(/^REFRESH_TOKEN_SECRET=(.+)$/m);
  if (!refreshMatch || isWeakSecret(stripEnvQuotes(refreshMatch[1]))) missing.push('REFRESH_TOKEN_SECRET');
  return missing;
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

// 启动服务（单端口模式，后端同时提供 API 和静态文件）
async function startServices() {
  // 先加载.env以获取用户配置的端口
  loadEnvFile(envPath);

  colorLog('\n🚀 启动 Timetrace 服务...', 'cyan');

  // 启动后端服务
  colorLog('📡 启动服务...', 'yellow');

  // 设置环境变量
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    ENV_PATH: envPath
  };

  const backendProcess = spawn('node', ['src/server.js'], {
    cwd: path.join(projectRoot, 'backend'),
    stdio: 'pipe',
    detached: true,
    env: env
  });

  backendProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output.includes('Server running on port')) {
      colorLog('✅ 服务已启动', 'green');
    }
  });

  backendProcess.stderr.on('data', (data) => {
    colorLog(`服务错误: ${data.toString().trim()}`, 'red');
  });

  // 等待后端启动
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 显示访问信息
  const displayPort = process.env.PORT || '8192';
  colorLog('\n🎉 服务启动完成！', 'green');
  colorLog(`📱 访问地址: http://localhost:${displayPort}`, 'blue');
  colorLog('\n按 Ctrl+C 停止服务', 'yellow');

  // 处理退出信号
  process.on('SIGINT', () => {
    colorLog('\n🛑 正在停止服务...', 'yellow');

    if (process.platform === 'win32') {
      // Windows: 使用 taskkill 终止整个进程树并等待完成
      const killer = spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
      killer.on('close', () => {
        colorLog('✅ 服务已停止', 'green');
        process.exit(0);
      });
      killer.on('error', () => {
        colorLog('✅ 服务已停止', 'green');
        process.exit(0);
      });
    } else {
      // Unix/Linux/macOS: 终止进程组并等待子进程退出
      const exitHandler = () => {
        colorLog('✅ 服务已停止', 'green');
        process.exit(0);
      };

      // 如果子进程已经退出，直接清理退出，避免 once('exit') 无法触发导致挂起
      if (backendProcess.exitCode !== null || backendProcess.signalCode !== null) {
        exitHandler();
        return;
      }

      backendProcess.once('exit', exitHandler);

      try {
        process.kill(-backendProcess.pid);
      } catch (error) {
        // 进程可能已退出，忽略错误
      }
    }
  });

  // 保持进程运行
  backendProcess.unref();
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