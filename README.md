# 目标日历 - 自我管理与统计系统

一个功能丰富的自我管理日历应用，帮助用户设定目标、规划每一天，并通过数据可视化追踪进度，实现高效自律。

## 功能特点

### 🎯 目标管理
- 创建和管理多个长期目标
- 为每个目标设置截止日期和代表色
- 直观的目标卡片展示

### 📅 日历视图
- 月度日历界面，清晰展示每一天
- 支持月份导航和快速跳转到今天
- 可自定义周起始日（周一或周日）
- 可选择是否显示周末

### ✅ 任务管理
- 为每一天添加待办任务
- 任务完成状态跟踪
- 支持批量添加和编辑任务
- 任务描述和详细记录

### 📊 数据统计与可视化
- 月度任务完成率统计
- 连续完成天数追踪
- 任务完成趋势图表（折线图/柱状图）
- 可按月、季度、年度查看数据

### 👤 用户系统
- 用户注册和登录
- JWT令牌认证
- 刷新令牌机制
- 个人设置管理

### 🎨 主题与设置
- 多种主题选择（默认、海洋、森林）
- 个性化通知设置
- 自定义日历显示选项

## 安装与运行

### 环境要求
- Node.js 14.0 或更高版本
- Python 3.x（用于启动前端服务器）

### 安装步骤

1. **克隆项目**
   ```bash
   git clone [项目地址]
   cd Timetrace
   ```

2. **安装后端依赖**
   ```bash
   cd backend
   npm install
   ```

### 运行项目

#### 方式一：使用自动设置脚本（推荐）

1. **一键启动**
   ```bash
   # Windows
   start.bat
   
   # Linux/macOS
   chmod +x start.sh
   ./start.sh
   ```

2. **仅初始化环境**
   ```bash
   # Windows
   start.bat --init-only
   
   # Linux/macOS
   ./start.sh --init-only
   ```

3. **访问应用**

   打开浏览器访问：`http://localhost:8192`

#### 方式二：手动启动

1. **启动后端服务**（单端口模式，同时提供 API 和静态文件）
   ```bash
   cd backend
   npm start
   ```

2. **访问应用**

   打开浏览器访问：`http://localhost:8192`

### 方式三：使用Docker部署

#### 环境要求
- Docker
- Docker Compose

#### 运行步骤

1. **克隆项目**
   ```bash
   git clone [项目地址]
   cd Timetrace
   ```

2. **初始化环境**
   ```bash
   node setup.js --init-only
   ```

3. **使用Docker Compose启动服务**
   ```bash
   docker-compose up -d
   ```

   或者直接使用Docker命令：
   ```bash
   # 构建镜像
   docker build -t timetrace:latest .
   
   # 运行容器
   docker run -d --name timetrace -p 8192:8192 -v ./backend/src/data:/app/data timetrace:latest
   ```

4. **访问应用**
   - 打开浏览器访问：`http://localhost:8192`

5. **停止服务**
   ```bash
   docker-compose down
   ```

#### 优势

- **简化部署**：单个容器包含完整应用
- **资源占用少**：相比多容器方案节省资源
- **易于管理**：只需管理一个容器
- **快速启动**：容器内服务同时启动

详细部署说明请参考：[DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)

**目标日历** - 让每一天都充满目标与成就感！