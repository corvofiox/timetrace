# 单一Docker镜像部署指南

本指南说明如何将整个目标日历应用打包为单个Docker镜像，并运行该镜像。

## 文件说明

- `Dockerfile.all-in-one`: 单一镜像的Dockerfile
- `docker-compose.all-in-one.yml`: 单一镜像的Docker Compose配置
- `start.sh`: 启动脚本（可选，已内嵌到Dockerfile中）

## 部署方式一：使用Docker Compose（推荐）

### 构建并运行镜像

```bash
# 使用docker-compose构建并运行
docker-compose -f docker-compose.all-in-one.yml up -d

# 查看运行状态
docker-compose -f docker-compose.all-in-one.yml ps

# 查看日志
docker-compose -f docker-compose.all-in-one.yml logs -f
```

### 访问应用

- 前端：http://localhost:8000
- 后端API：http://localhost:3000

### 停止服务

```bash
docker-compose -f docker-compose.all-in-one.yml down
```

## 部署方式二：直接使用Docker命令

### 构建镜像

```bash
# 构建镜像
docker build -f Dockerfile.all-in-one -t timetrace-app:latest .

# 查看镜像
docker images | grep timetrace
```

### 运行容器

```bash
# 运行容器
docker run -d \
  --name timetrace-app \
  -p 3000:3000 \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  timetrace-app:latest

# 查看运行状态
docker ps | grep timetrace

# 查看日志
docker logs -f timetrace-app
```

### 停止容器

```bash
# 停止容器
docker stop timetrace-app

# 删除容器
docker rm timetrace-app
```

## 数据持久化

应用数据存储在容器的`/app/data`目录中。为了持久化数据，我们将主机的`./data`目录挂载到容器的`/app/data`目录。

首次运行前，请确保在主机上创建数据目录：

```bash
mkdir -p ./data
```

## 环境变量配置

以下环境变量已配置在Dockerfile和docker-compose文件中：

- `NODE_ENV`: 运行环境（production）
- `JWT_SECRET`: JWT访问令牌签名密钥
- `JWT_EXPIRE`: 访问令牌过期时间（15m）
- `REFRESH_TOKEN_SECRET`: JWT刷新令牌签名密钥
- `REFRESH_TOKEN_EXPIRE`: 刷新令牌过期时间（7d）

如需自定义这些变量，可以在运行时通过`-e`参数覆盖：

```bash
docker run -d \
  --name timetrace-app \
  -p 3000:3000 \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  -e JWT_SECRET="your_custom_secret" \
  timetrace-app:latest
```

## 故障排除

### 检查容器状态

```bash
docker ps -a
```

### 查看容器日志

```bash
docker logs timetrace-app
```

### 进入容器调试

```bash
docker exec -it timetrace-app sh
```

### 重新构建镜像

```bash
# 强制重新构建（不使用缓存）
docker-compose -f docker-compose.all-in-one.yml build --no-cache

# 或者使用Docker命令
docker build -f Dockerfile.all-in-one --no-cache -t timetrace-app:latest .
```

## 生产环境部署建议

1. **使用更安全的密钥**：在生产环境中，使用Docker secrets或Kubernetes secrets管理JWT密钥
2. **配置反向代理**：使用Nginx或Traefik作为反向代理，处理HTTPS和负载均衡
3. **设置资源限制**：为容器设置CPU和内存限制
4. **配置健康检查**：添加健康检查端点，确保服务正常运行
5. **日志管理**：配置日志驱动，将日志发送到集中式日志系统

## 端口说明

- **3000端口**: 后端API服务，提供RESTful API接口
- **8000端口**: 前端Web服务，提供用户界面

这两个端口都可以在docker-compose.yml或docker run命令中自定义映射到主机的不同端口。