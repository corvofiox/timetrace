#!/bin/sh

echo ""
echo "========================================"
echo "  Timetrace 项目启动器 (Linux/macOS)"
echo "========================================"
echo ""

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "错误: 未检测到Node.js，请先安装Node.js"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

# 检查命令行参数
if [ "$1" = "--init-only" ]; then
    echo "仅初始化环境..."
    node setup.js --init-only
    exit 0
fi

# 检查.env文件是否存在
# Docker环境: /app/data/.env
# 本地环境: backend/src/data/.env
if [ -f "/.dockerenv" ]; then
    ENV_FILE="/app/data/.env"
else
    ENV_FILE="backend/src/data/.env"
fi

if [ -f "$ENV_FILE" ]; then
    echo "环境配置文件已存在: $ENV_FILE"
    echo "跳过初始化"
else
    echo "环境配置文件不存在，正在初始化..."
    node setup.js --init-only
fi

# 启动服务（单端口模式）
echo ""
echo "启动服务..."
node start-services.js
