#!/bin/sh

# 启动脚本 - 同时启动前端和后端服务

# 设置后端端口
export PORT=3000

# 启动后端服务（在后台运行）
echo "Starting backend server on port 3000..."
cd /app/backend
npm start &

# 等待后端启动
sleep 5

# 启动前端服务（在后台运行）
echo "Starting frontend server on port 8000..."
cd /app/frontend
python3 -m http.server 8000 &

# 等待所有后台进程
wait