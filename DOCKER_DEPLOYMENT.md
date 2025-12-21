# Docker部署指南

## 简单部署（推荐）

### 1. 使用Docker Compose（最简单）

```bash
# 克隆项目
git clone <repository-url>
cd Timetrace

# 直接启动（密钥将自动生成）
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### 2. 使用Docker命令

```bash
# 构建镜像
docker build -t timetrace-app:latest .

# 运行容器（密钥将自动生成）
docker run -d \
  --name timetrace-app \
  -p 3000:3000 \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  timetrace-app:latest
```

## 高级部署（自定义密钥）

### 1. 创建自定义密钥

```bash
# 创建.env文件
cp .env.example .env

# 编辑.env文件，添加自定义密钥
# JWT_SECRET=your_custom_jwt_secret
# REFRESH_TOKEN_SECRET=your_custom_refresh_secret
```

### 2. 使用自定义密钥启动

```bash
# 使用Docker Compose
docker-compose up -d

# 或使用Docker命令
docker run -d \
  --name timetrace-app \
  -p 3000:3000 \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  timetrace-app:latest
```

## 密钥管理说明

### 自动密钥生成
- 如果未提供JWT_SECRET和REFRESH_TOKEN_SECRET，系统将在首次启动时自动生成
- 密钥保存在数据目录中的`.jwt_secret`和`.refresh_secret`文件
- 生成的密钥是64字节的Base64编码字符串，具有足够的安全性

### 密钥持久化
- 自动生成的密钥会保存在挂载的数据目录中
- 只要数据目录不被删除，密钥在容器重启后会保持一致
- 如果删除数据目录，将重新生成新的密钥（所有现有令牌将失效）

### 生产环境建议
- 生产环境建议手动设置密钥以确保一致性
- 使用强随机字符串（至少32字节）
- 定期轮换密钥（需要考虑现有令牌失效的影响）

## 访问应用

- 前端界面：http://localhost:8000
- 后端API：http://localhost:3000

## 数据持久化

- 用户数据、目标、日程等保存在挂载的数据目录中
- 密钥文件也保存在同一目录中
- 确保数据目录有适当的备份策略

## 故障排除

### 查看密钥
```bash
# 查看自动生成的JWT密钥
cat data/.jwt_secret

# 查看自动生成的刷新令牌密钥
cat data/.refresh_secret
```

### 重置密钥
```bash
# 删除密钥文件（下次启动将重新生成）
rm data/.jwt_secret data/.refresh_secret data/.keys_generated

# 重启容器
docker-compose restart
```