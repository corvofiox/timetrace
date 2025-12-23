# 多阶段构建 - 构建阶段
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制后端package文件
COPY backend/package*.json ./backend/

# 安装后端依赖
RUN cd backend && npm ci --only=production

# 生产阶段
FROM node:18-alpine AS production

# 安装Python、OpenSSL和curl用于启动前端服务器、生成密钥和健康检查
RUN apk add --no-cache python3 openssl curl

# 设置工作目录
WORKDIR /app

# 从构建阶段复制后端依赖
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/package*.json ./backend/

# 复制后端源代码
COPY backend/src ./backend/src

# 复制前端文件
COPY index.html ./
COPY styles ./styles
COPY js ./js
COPY libs ./libs

# 复制启动脚本
COPY setup.js /app/setup.js
COPY start.sh /app/start.sh

# 设置环境变量（必须在初始化之前设置）
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# 创建数据目录并初始化环境
RUN mkdir -p /app/data
RUN node /app/setup.js --init-only

# 暴露端口
EXPOSE 3000 8000

# 确保脚本有正确的格式和执行权限
RUN chmod +x /app/start.sh && sed -i 's/\r$//' /app/start.sh

# 启动应用
CMD ["/bin/sh", "/app/start.sh"]