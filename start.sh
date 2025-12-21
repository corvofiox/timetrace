#!/bin/sh

# 确保数据目录存在
mkdir -p /app/data

# 密钥文件路径
JWT_SECRET_FILE="/app/data/.jwt_secret"
REFRESH_SECRET_FILE="/app/data/.refresh_secret"
KEYS_GENERATED_FLAG="/app/data/.keys_generated"

# 检查是否需要生成密钥
if [ ! -f "$KEYS_GENERATED_FLAG" ] && [ -z "$JWT_SECRET" ] && [ -z "$REFRESH_TOKEN_SECRET" ]; then
    echo "首次启动，自动生成安全密钥..."
    
    # 生成JWT密钥 (64字节强随机字符串)
    openssl rand -base64 64 > "$JWT_SECRET_FILE"
    export JWT_SECRET=$(cat "$JWT_SECRET_FILE")
    
    # 生成刷新令牌密钥 (64字节强随机字符串)
    openssl rand -base64 64 > "$REFRESH_SECRET_FILE"
    export REFRESH_TOKEN_SECRET=$(cat "$REFRESH_SECRET_FILE")
    
    # 创建生成标记文件
    touch "$KEYS_GENERATED_FLAG"
    
    echo "密钥已生成并保存在数据目录中"
elif [ -f "$JWT_SECRET_FILE" ] && [ -z "$JWT_SECRET" ]; then
    # 从文件加载JWT密钥
    export JWT_SECRET=$(cat "$JWT_SECRET_FILE")
fi

# 启动后端服务
cd /app/backend && npm start &

# 等待后端启动
sleep 2

# 启动前端服务
cd /app && python3 -m http.server 8000