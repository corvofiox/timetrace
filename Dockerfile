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

# 安装Python用于启动前端服务器
RUN apk add --no-cache python3

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

# 创建数据目录
RUN mkdir -p /app/data

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV JWT_SECRET=change_me_in_production
ENV JWT_EXPIRE=15m
ENV REFRESH_TOKEN_SECRET=change_me_in_production
ENV REFRESH_TOKEN_EXPIRE=7d
ENV DATA_DIR=/app/data

# 暴露端口
EXPOSE 3000 8000

# 复制启动脚本
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 启动应用
CMD ["/app/start.sh"]