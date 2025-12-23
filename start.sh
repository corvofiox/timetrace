#!/bin/bash

echo ""
echo "========================================"
echo "  Timetrace 项目启动器 (Linux/macOS)"
echo "========================================"
echo ""

# 在Docker环境中，确保.env文件存在
if [ ! -f "/app/data/.env" ]; then
    echo "Docker环境中未找到.env文件，正在创建..."
    node /app/setup.js --init-only
fi

# 运行设置脚本
node /app/setup.js "$@"