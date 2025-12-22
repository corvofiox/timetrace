const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 颜色输出函数
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function colorLog(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 项目根目录
const projectRoot = __dirname;

// 启动服务
async function startServices() {
  colorLog('🚀 启动 Timetrace 服务...', 'cyan');
  
  // 检查.env文件
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) {
    colorLog('❌ 错误: .env文件不存在，请先运行 start.bat --init-only', 'red');
    process.exit(1);
  }
  
  // 创建数据目录
  const dataDir = path.join(projectRoot, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // 启动后端服务
  colorLog('📡 启动后端服务...', 'yellow');
  const backendProcess = spawn('node', ['src/server.js'], {
    cwd: path.join(projectRoot, 'backend'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  let backendStarted = false;
  backendProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    console.log(`[后端] ${output}`);
    if (output.includes('Server running on port') && !backendStarted) {
      backendStarted = true;
      colorLog('✅ 后端服务已启动', 'green');
    }
  });
  
  backendProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    console.error(`[后端错误] ${output}`);
  });
  
  backendProcess.on('error', (error) => {
    colorLog(`后端启动失败: ${error.message}`, 'red');
    process.exit(1);
  });
  
  backendProcess.on('close', (code) => {
    if (code !== 0) {
      colorLog(`后端进程退出，代码: ${code}`, 'red');
    }
  });
  
  // 等待后端启动
  await new Promise(resolve => {
    const checkInterval = setInterval(() => {
      if (backendStarted) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
    
    // 最多等待10秒
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 10000);
  });
  
  // 启动前端服务
  colorLog('🌐 启动前端服务...', 'yellow');
  const frontendProcess = spawn('python', ['-m', 'http.server', '8000'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  let frontendStarted = false;
  frontendProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    console.log(`[前端] ${output}`);
    if (output.includes('Serving HTTP on') && !frontendStarted) {
      frontendStarted = true;
      colorLog('✅ 前端服务已启动', 'green');
    }
  });
  
  frontendProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    console.error(`[前端错误] ${output}`);
  });
  
  frontendProcess.on('error', (error) => {
    colorLog(`前端启动失败: ${error.message}`, 'red');
    process.exit(1);
  });
  
  frontendProcess.on('close', (code) => {
    if (code !== 0) {
      colorLog(`前端进程退出，代码: ${code}`, 'red');
    }
  });
  
  // 等待前端启动
  await new Promise(resolve => {
    const checkInterval = setInterval(() => {
      if (frontendStarted) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
    
    // 最多等待5秒
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 5000);
  });
  
  // 显示访问信息
  colorLog('\n🎉 服务启动完成！', 'green');
  colorLog('📱 前端地址: http://localhost:8000', 'blue');
  colorLog('🔧 后端地址: http://localhost:3000', 'blue');
  colorLog('\n按 Ctrl+C 停止所有服务', 'yellow');
  
  // 处理退出信号
  process.on('SIGINT', () => {
    colorLog('\n🛑 正在停止服务...', 'yellow');
    
    // 终止子进程
    backendProcess.kill();
    frontendProcess.kill();
    
    colorLog('✅ 服务已停止', 'green');
    process.exit(0);
  });
  
  // 保持进程运行
  process.stdin.resume();
}

// 主函数
async function main() {
  try {
    colorLog('🌟 Timetrace 项目启动器', 'bright');
    colorLog('================================', 'cyan');
    
    await startServices();
  } catch (error) {
    colorLog(`\n❌ 错误: ${error.message}`, 'red');
    process.exit(1);
  }
}

// 运行主函数
main();