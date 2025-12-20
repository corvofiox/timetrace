# 目标日历 - 多目标、任务与热力图系统

一个功能丰富的目标管理和日历应用，帮助用户设定目标、规划每一天，并通过数据可视化追踪进度。

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

## 技术架构

### 前端技术
- **HTML5** - 语义化标记
- **CSS3** - 现代样式与动画
- **原生JavaScript** - 无框架依赖
- **Chart.js** - 数据可视化
- **RemixIcon** - 图标库

### 后端技术
- **Node.js** - 服务器运行环境
- **Express.js** - Web应用框架
- **JWT** - 身份认证
- **bcryptjs** - 密码加密
- **文件数据库** - JSON文件存储

## 项目结构

```
Timetrace/
├── backend/                 # 后端服务
│   ├── src/
│   │   ├── config/         # 配置文件
│   │   │   ├── database.js
│   │   │   └── fileDB.js
│   │   ├── controllers/    # 控制器
│   │   │   ├── auth.js
│   │   │   ├── days.js
│   │   │   └── goals.js
│   │   ├── data/          # 数据存储
│   │   │   ├── days.json
│   │   │   ├── goals.json
│   │   │   ├── idCounters.json
│   │   │   ├── refreshTokens.json
│   │   │   └── users.json
│   │   ├── middleware/     # 中间件
│   │   │   └── auth.js
│   │   ├── routes/         # 路由
│   │   │   ├── auth.js
│   │   │   ├── days.js
│   │   │   └── goals.js
│   │   └── server.js      # 服务器入口
│   ├── .env               # 环境变量
│   ├── package.json       # 项目配置
│   └── package-lock.json  # 依赖锁定
├── js/                    # 前端脚本
│   ├── api.js            # API调用
│   └── app.js            # 应用逻辑
├── styles/               # 样式文件
│   └── main.css         # 主样式
├── index.html            # 主页面
└── README.md             # 项目文档
```

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

3. **配置环境变量**
   
   在 `backend` 目录下创建 `.env` 文件，配置以下变量：
   ```
   PORT=3000
   JWT_SECRET=your_jwt_secret_key
   JWT_REFRESH_SECRET=your_jwt_refresh_secret_key
   ```

### 运行项目

1. **启动后端服务**
   ```bash
   cd backend
   npm start
   ```

2. **启动前端服务**
   
   在项目根目录下：
   ```bash
   # 使用Python内置HTTP服务器
   python -m http.server 8080
   
   # 或使用Node.js的http-server（需要先安装）
   npx http-server -p 8080
   ```

3. **访问应用**
   
   打开浏览器访问：`http://localhost:8080`

## API文档

### 认证接口

- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `POST /api/auth/refresh` - 刷新令牌
- `GET /api/auth/me` - 获取当前用户信息

### 目标管理接口

- `GET /api/goals` - 获取用户所有目标
- `POST /api/goals` - 创建新目标
- `PUT /api/goals/:id` - 更新目标
- `DELETE /api/goals/:id` - 删除目标

### 日期管理接口

- `GET /api/days` - 获取日期数据
- `POST /api/days` - 创建或更新日期数据
- `GET /api/days/stats` - 获取统计数据

## 数据结构

### 用户数据
```json
{
  "id": "用户ID",
  "username": "用户名",
  "email": "邮箱",
  "password": "加密后的密码",
  "createdAt": "创建时间"
}
```

### 目标数据
```json
{
  "id": "目标ID",
  "userId": "所属用户ID",
  "name": "目标名称",
  "targetDate": "目标日期",
  "color": "代表色",
  "createdAt": "创建时间"
}
```

### 日期数据
```json
{
  "id": "日期ID",
  "userId": "所属用户ID",
  "date": "日期字符串",
  "summary": "当日备注",
  "tasks": [
    {
      "id": "任务ID",
      "title": "任务标题",
      "description": "任务描述",
      "completed": "完成状态",
      "goalId": "关联目标ID"
    }
  ]
}
```
---

**目标日历** - 让每一天都充满目标与成就感！