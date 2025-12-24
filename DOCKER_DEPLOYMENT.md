# Docker 部署指南

## 概述
本指南说明如何使用Docker容器化部署Timetrace应用程序。

## 前置要求
1. 安装Docker Desktop (Windows) 或 Docker Engine (Linux/macOS)
2. 确保Docker服务正在运行

## 构建Docker镜像

### 1. 克隆或下载项目
```bash
git clone <repository-url>
cd Timetrace
```

### 2. 初始化环境
```bash
# 初始化项目环境，生成.env文件和数据目录
node setup.js --init-only
```

**重要**: `setup.js` 仅负责初始化环境，不会启动服务。使用 `--init-only` 参数确保只进行环境准备。

### 3. 构建Docker镜像
```bash
docker build -t timetrace:latest .
```

### 4. 运行Docker容器
```bash
# 基本运行
docker run -d -p 3000:3000 -p 8000:8000 --name timetrace timetrace:latest

# 持久化数据存储（推荐）
docker run -d -p 3000:3000 -p 8000:8000 -v ./backend/src/data:/app/data --name timetrace timetrace:latest

# 使用Docker Compose（推荐）
docker-compose up -d
```

### 4. 访问应用程序
- 前端界面: http://localhost:8000
- 后端API: http://localhost:3000

## Docker配置说明

### Dockerfile
项目使用多阶段构建:
1. **构建阶段**: 安装后端依赖
2. **生产阶段**: 复制所有应用文件和依赖到最终镜像

### 启动脚本
- 容器使用 `start.sh` 作为启动入口
- `start.sh` 自动调用 `setup.js` 进行环境检查，然后调用 `start-services.js` 启动服务
- `start-services.js` 负责启动前端和后端服务
- 支持健康检查和优雅关闭

### 端口映射
- 3000: 后端API服务
- 8000: 前端静态文件服务

### 数据持久化
应用程序数据存储在 `/app/data` 目录中，包括：
- 用户数据 (users.json)
- 目标数据 (goals.json)
- 日记录数据 (days.json)
- 刷新令牌数据 (refreshTokens.json)
- 环境配置文件 (.env)

建议使用Docker卷或绑定挂载来持久化数据。

## 环境变量
以下环境变量可在运行时覆盖:
- `PORT`: 后端服务端口 (默认: 3000)
- `DATA_DIR`: 数据存储目录 (默认: /app/data)
- `NODE_ENV`: 运行环境 (默认: production)

## 故障排除

### 容器启动失败
1. 检查端口是否已被占用
2. 查看容器日志: `docker logs timetrace`

### 数据丢失
确保使用 `-v` 参数挂载外部数据目录

### 性能问题
1. 确保Docker Desktop分配足够的资源
2. 考虑使用SSD存储数据卷

## 更新应用

### 1. 重新构建镜像
```bash
docker build -t timetrace:latest .
```

### 2. 停止并删除旧容器
```bash
docker stop timetrace
docker rm timetrace
```

### 3. 启动新容器
```bash
docker run -d -p 3000:3000 -p 8000:8000 -v /path/to/data:/app/data --name timetrace timetrace:latest
```

## 生产环境部署建议

1. 使用反向代理 (如Nginx) 处理HTTPS
2. 设置环境变量 `NODE_ENV=production`
3. 定期备份数据目录
4. 监控容器资源使用情况
5. 考虑使用Docker Compose进行多容器编排

## Docker Compose 配置示例

```yaml
version: '3.8'

services:
  timetrace:
    build: .
    ports:
      - "3000:3000"
      - "8000:8000"
    volumes:
      - ./backend/src/data:/app/data  # 挂载数据目录(包含.env文件)
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATA_DIR=/app/data
    restart: unless-stopped
```

**注意**: 使用 Docker Compose 前，请先运行 `node setup.js --init-only` 生成 `.env` 文件。`.env` 文件会被生成在 `backend/src/data` 目录中，与数据文件一起挂载到容器中。

## 脚本说明

### start.bat (Windows)
- Windows 平台的启动入口
- 自动调用 `setup.js --init-only` 进行环境检查（如果.env不存在）
- 然后调用 `start-services.js` 启动服务
- 支持 `--init-only` 参数仅初始化环境

### start.sh (Linux/macOS/Docker)
- Linux/macOS/Docker 平台的启动入口
- 自动调用 `setup.js --init-only` 进行环境检查（如果.env不存在）
- 然后调用 `start-services.js` 启动服务
- 支持 `--init-only` 参数仅初始化环境

### setup.js
- 负责环境初始化
- 创建数据目录和 `.env` 文件
- 生成 JWT 密钥
- 安装后端依赖
- 使用 `--init-only` 参数时不会启动服务

### start-services.js
- 负责启动前端和后端服务
- 自动检测环境（本地/Docker）
- 健康检查确保服务正常启动
- 支持优雅关闭