#!/bin/sh

# 确保数据目录存在
mkdir -p /app/data

# 启动后端服务
cd /app/backend && npm start &

# 等待后端启动
sleep 2

# 启动前端服务
cd /app && python3 -m http.server 8000