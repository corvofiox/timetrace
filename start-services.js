const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { getProjectRoot, getDataDir, getEnvPath } = require('./backend/src/utils/env');

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

// 进程管理器
class ProcessManager {
  constructor() {
    this.processes = {};
    this.shuttingDown = false;
  }

  addProcess(name, process) {
    this.processes[name] = process;
  }

  async stopProcess(name, timeout = 5000) {
    const process = this.processes[name];
    if (!process || process.killed) {
      return;
    }

    colorLog(`正在停止 ${name}...`, 'yellow');
    
    // 尝试优雅关闭
    process.kill('SIGTERM');
    
    // 等待进程退出
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeout);
      
      process.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    
    // 如果进程没有退出，强制终止
    if (!exited) {
      colorLog(`${name} 未响应，强制终止...`, 'yellow');
      process.kill('SIGKILL');
      await new Promise(resolve => process.once('exit', resolve));
    }
    
    colorLog(`${name} 已停止`, 'green');
  }

  async stopAll() {
    if (this.shuttingDown) {
      return;
    }
    
    this.shuttingDown = true;
    colorLog('\n🛑 正在停止所有服务...', 'yellow');
    
    // 先停止前端
    if (this.processes.frontend) {
      await this.stopProcess('frontend');
    }
    
    // 再停止后端
    if (this.processes.backend) {
      await this.stopProcess('backend');
    }
    
    colorLog('✅ 所有服务已停止', 'green');
  }
}

// 健康检查函数
function checkHealth(port, path = '/') {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: path,
      method: 'GET',
      timeout: 2000
    };
    
    const req = http.request(options, (res) => {
      resolve(res.statusCode < 500);
    });
    
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
}

// 启动服务
async function startServices() {
  const processManager = new ProcessManager();
  
  colorLog('🚀 启动 Timetrace 服务...', 'cyan');
  
  // 检查.env文件
  const envPath = path.join(projectRoot, 'backend', 'src', 'data', '.env');
  if (!fs.existsSync(envPath)) {
    colorLog('❌ 错误: .env文件不存在，请先运行 start.bat --init-only', 'red');
    process.exit(1);
  }
  
  // 创建数据目录
  const dataDir = path.join(projectRoot, 'backend', 'src', 'data');
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
  
  processManager.addProcess('backend', backendProcess);
  
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
    if (code !== 0 && !processManager.shuttingDown) {
      colorLog(`后端进程退出，代码: ${code}`, 'red');
      process.exit(1);
    }
  });
  
  // 使用健康检查等待后端启动
  colorLog('等待后端服务就绪...', 'yellow');
  await new Promise(resolve => {
    const checkInterval = setInterval(async () => {
      const isHealthy = await checkHealth(3000);
      if (isHealthy || backendStarted) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
    
    // 最多等待15秒
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 15000);
  });
  
  // 启动前端服务
  colorLog('🌐 启动前端服务...', 'yellow');
  const frontendProcess = spawn('python', ['-m', 'http.server', '8000'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  processManager.addProcess('frontend', frontendProcess);
  
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
    if (code !== 0 && !processManager.shuttingDown) {
      colorLog(`前端进程退出，代码: ${code}`, 'red');
      process.exit(1);
    }
  });
  
  // 使用健康检查等待前端启动
  colorLog('等待前端服务就绪...', 'yellow');
  await new Promise(resolve => {
    const checkInterval = setInterval(async () => {
      const isHealthy = await checkHealth(8000);
      if (isHealthy || frontendStarted) {
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
  
  // 显示访问信息
  colorLog('\n🎉 服务启动完成！', 'green');
  colorLog('📱 前端地址: http://localhost:8000', 'blue');
  colorLog('🔧 后端地址: http://localhost:3000', 'blue');
  colorLog('\n按 Ctrl+C 停止所有服务', 'yellow');
  
  // 处理退出信号
  const handleShutdown = async () => {
    await processManager.stopAll();
    process.exit(0);
  };
  
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
  
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