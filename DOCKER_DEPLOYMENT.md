# Docker 部署指南

## 环境变量配置

项目使用单一 `.env` 文件管理环境变量，简化配置流程。

### 环境变量文件说明

1. **.env.example** - 环境变量模板文件，包含所有可配置项和说明
2. **.env** - 实际使用的环境变量文件（不应提交到版本控制）
3. **backend/.env** - 原有的后端环境变量文件（保留兼容性）

### 配置步骤

1. 复制环境变量模板：
   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env` 文件，填入实际值：
   ```bash
   # 生产环境必须使用强随机密钥
   JWT_SECRET=your_production_jwt_secret
   REFRESH_TOKEN_SECRET=your_production_refresh_token_secret
   ```

## Docker 部署

### 方法一：使用 Docker Compose（推荐）

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 方法二：直接使用 Docker 命令

```bash
# 构建镜像
docker build -t timetrace-app:latest .

# 运行容器
docker run -d \
  --name timetrace-app \
  -p 3000:3000 \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  timetrace-app:latest
```

## 安全建议

1. **密钥管理**：
   - 生产环境必须使用强随机密钥
   - 定期轮换密钥
   - 不要将 `.env` 文件提交到版本控制

2. **生成强密钥**：
   ```bash
   # 生成JWT密钥
   openssl rand -base64 64
   
   # 生成刷新令牌密钥
   openssl rand -base64 64
   ```

3. **数据备份**：
   - 定期备份 `./data` 目录
   - 考虑使用云存储或网络存储

## 访问应用

- 前端界面：http://localhost:8000
- 后端API：http://localhost:3000

## 故障排除

1. **端口冲突**：
   - 修改 docker-compose.yml 中的端口映射
   - 或停止占用端口的其他服务

2. **权限问题**：
   - 确保 `./data` 目录有写权限
   - 检查 Docker 容器的用户权限

3. **密钥错误**：
   - 检查 `.env` 文件中的密钥配置
   - 确保密钥长度和格式正确