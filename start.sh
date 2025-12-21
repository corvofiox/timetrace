#!/bin/sh

# 确保数据目录存在
mkdir -p /app/data

# 自动生成密钥（如果不存在）
if [ ! -f /app/data/.jwt_secret ]; then
    echo "生成JWT密钥..."
    openssl rand -base64 64 > /app/data/.jwt_secret
fi

if [ ! -f /app/data/.refresh_secret ]; then
    echo "生成刷新令牌密钥..."
    openssl rand -base64 64 > /app/data/.refresh_secret
fi

# 设置环境变量
export JWT_SECRET=$(cat /app/data/.jwt_secret)
export REFRESH_TOKEN_SECRET=$(cat /app/data/.refresh_secret)

# 显示密钥信息（仅在首次生成时）
if [ ! -f /app/data/.keys_generated ]; then
    echo "========================================"
    echo "密钥已自动生成并保存在数据目录中"
    echo "JWT密钥文件: /app/data/.jwt_secret"
    echo "刷新令牌密钥文件: /app/data/.refresh_secret"
    echo "========================================"
    touch /app/data/.keys_generated
fi

# 启动后端服务
cd /app/backend && npm start &

# 等待后端启动
sleep 2

# 启动前端服务
cd /app && python3 -m http.server 8000