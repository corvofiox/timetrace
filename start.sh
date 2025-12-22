#!/bin/bash

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

# 检查Python是否安装
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "错误: 未检测到Python，请先安装Python"
    echo "下载地址: https://www.python.org/downloads/"
    exit 1
fi

# 在Docker环境中，确保.env文件存在且包含有效密钥
if [ ! -f "/app/.env" ]; then
    echo "Docker环境中未找到.env文件，正在创建..."
    node setup.js --init-only
else
    # 检查密钥是否有效
    if ! grep -q "JWT_SECRET=[^[:space:]]" /app/.env || ! grep -q "REFRESH_TOKEN_SECRET=[^[:space:]]" /app/.env; then
        echo "Docker环境中.env文件密钥无效，正在重新生成..."
        node setup.js --init-only
    fi
fi

# 验证.env文件内容
echo "验证.env文件内容..."
cat /app/.env | grep -E "(JWT_SECRET|REFRESH_TOKEN_SECRET)"

# 运行设置脚本
node setup.js "$@"