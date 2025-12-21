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
else
    # 如果环境变量未设置，尝试从文件加载
    if [ -z "$JWT_SECRET" ] && [ -f "$JWT_SECRET_FILE" ]; then
        echo "从文件加载JWT密钥..."
        export JWT_SECRET=$(cat "$JWT_SECRET_FILE")
    fi
    
    if [ -z "$REFRESH_TOKEN_SECRET" ] && [ -f "$REFRESH_SECRET_FILE" ]; then
        echo "从文件加载刷新令牌密钥..."
        export REFRESH_TOKEN_SECRET=$(cat "$REFRESH_SECRET_FILE")
    fi
fi

# 验证密钥是否已设置
if [ -z "$JWT_SECRET" ] || [ -z "$REFRESH_TOKEN_SECRET" ]; then
    echo "错误：JWT密钥或刷新令牌密钥未设置！"
    echo "请检查环境变量或密钥文件。"
    exit 1
fi

echo "JWT密钥状态：已设置"
echo "刷新令牌密钥状态：已设置"

# 启动后端服务
cd /app/backend && npm start &

# 等待后端启动
sleep 2

# 启动前端服务
cd /app && python3 -m http.server 8000