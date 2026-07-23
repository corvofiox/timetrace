# 快速启动指南

## 一键启动项目

我们提供了跨平台的自动设置脚本，可以一键初始化环境并启动项目。

### Windows 用户

1. 双击运行 `start.bat` 文件
2. 或在命令行中执行：
   ```bash
   .\start.bat
   ```

### Linux/macOS 用户

1. 在终端中执行：
   ```bash
   chmod +x start.sh
   ./start.sh
   ```

## 脚本功能

自动设置脚本 (`setup.js`) 提供以下功能：

1. **环境检查** - 检查 Node.js 和 Python 是否已安装
2. **自动初始化** - 创建必要的数据目录和配置文件
3. **安全密钥生成** - 自动生成强随机 JWT 密钥
4. **依赖安装** - 自动安装后端依赖
5. **服务启动** - 启动服务（单端口模式，同时提供 API 和静态文件）

## 命令行选项

- `--init-only` - 仅初始化环境，不启动服务
- `--no-keys` - 不生成新密钥（如果.env已存在）

示例：
```bash
# 仅初始化环境
.\start.bat --init-only

# 初始化但不覆盖现有密钥
./start.sh --init-only --no-keys
```

## 安全说明

- 脚本会自动生成安全的随机密钥
- `.env` 文件包含敏感信息，已添加到 `.gitignore`
- 请勿将 `.env` 文件提交到版本控制系统

## 故障排除

1. **Node.js 未安装**
   - 下载地址：https://nodejs.org/

2. **Python 未安装**
   - 下载地址：https://www.python.org/downloads/

3. **端口占用**
   - 确保 8192 端口未被占用
   - 或修改 `.env` 文件中的 PORT 配置

## 手动启动

如果自动脚本无法使用，您也可以手动启动：

1. 启动服务（单端口模式，同时提供 API 和静态文件）：
   ```bash
   cd backend
   npm start
   ```

2. 访问：http://localhost:8192