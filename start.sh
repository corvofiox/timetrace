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

# 运行设置脚本
node setup.js "$@"