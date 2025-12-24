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

# 安装Python、OpenSSL、curl和dos2unix用于启动前端服务器、生成密钥、健康检查和转换行尾符
RUN apk add --no-cache python3 openssl curl dos2unix

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
# setup.js: 环境初始化脚本（仅在需要时运行）
# start-services.js: 服务启动脚本（启动前端和后端）
# start.sh: Linux/macOS/Docker 启动入口（调用 setup.js 和 start-services.js）
COPY setup.js /app/setup.js
COPY start-services.js /app/start-services.js
COPY start.sh /app/start.sh

# 转换start.sh的行尾符（从CRLF到LF）并添加执行权限
RUN dos2unix /app/start.sh && chmod +x /app/start.sh

# 创建数据目录（.env文件通过卷挂载从宿主机映射）
RUN mkdir -p /app/data

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# 暴露端口
EXPOSE 3000 8000

# 启动应用
CMD ["/app/start.sh"]