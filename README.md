# 权威综合导航页

一个面向政务、官媒、高校、工具等权威网站的综合导航页。支持自定义分类与链接、多主题切换，并提供 Express 后端与 Docker 部署能力。

## 功能特性

- **多源分类导航**：国家机关、权威官媒、985 / 211 高校、官方数据查询、法律标准核验、学术科研资源、政务实用工具。
- **自定义增删**：可添加/删除分类与链接；自定义内容通过后端 API 持久化，纯静态打开时自动回退到浏览器 localStorage。
- **主题切换**：支持「抖音暗色」「Claude 浅色」「Claude 深色」「Apple 浅色」「Apple 深色」五种配色方案，主题偏好保存在浏览器端。
- **实时搜索**：顶部搜索栏可即时过滤所有分类下的网站。
- **微服务化**：基于 Express 提供静态服务与数据 API，可通过 Docker / Docker Compose 一键部署。

## 技术栈

- 前端：HTML5 + CSS3（CSS 自定义属性主题）+ 原生 JavaScript
- 后端：Node.js + Express
- 部署：Docker、Docker Compose

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `ADMIN_TOKEN` | 是 | 无 | 写接口管理口令，长度 >= 16 字符；未设置或过短时进程启动即报错退出（fail closed） |
| `WRITE_RATE_LIMIT_MAX` | 否 | `50` | 单 IP 每 15 分钟窗口允许的写请求次数 |
| `BACKUP_INTERVAL_HOURS` | 否 | `6` | SQLite 定时备份间隔（小时） |
| `BACKUP_KEEP` | 否 | `7` | 备份轮转保留份数（仅保留最新 N 份） |

本地开发可复制 `.env.example` 为 `.env` 并按需填写（`docker-compose` 会自动读取 `.env`）。

## 快速开始

### 本地 Node.js 运行

```bash
npm install
npm start
```

访问 http://localhost:3000

### 运行测试

```bash
npm install
npm test
```

测试使用 Jest + Supertest 编写，覆盖：

- `/health` 健康检查
- `/api/data` GET/POST 读写与持久化
- 输入校验（类型检查、URL 协议过滤、XSS 消毒、长度限制）
- 首页 HTML 返回
- Helmet 安全响应头

### Docker Compose 部署（推荐）

```bash
docker-compose up -d
```

访问 http://localhost:3000

**数据持久化说明：**

- 所有用户自定义内容（分类、链接、删除项、类别优先级顺序）都会保存在 SQLite 数据库 `./data/data.db`
- 启动时会自动检测并迁移旧版 `custom-data.json`（迁移成功后重命名为 `custom-data.json.migrated`）
- `docker-compose.yml` 已将 `./data` 挂载到容器的 `/app/data`，因此以下操作不会丢失数据：
  - 容器重启
  - 镜像重新构建
  - 升级到新版本
- `data/` 目录已加入 `.gitignore` 与 `.dockerignore`，不会进入镜像或 Git 仓库

> 注意：如果直接用 `docker run` 启动而不挂载卷，容器销毁后数据会丢失。请务必使用 Docker Compose 或手动挂载 `-v $(pwd)/data:/app/data`。

### SQLite 备份与恢复

应用进程内置定时备份：每 `BACKUP_INTERVAL_HOURS`（默认 6）小时对内存数据库做一次一致性快照，写入 `data/backups/backup-YYYYMMDD-HHmmss.db`，并仅保留最新 `BACKUP_KEEP`（默认 7）份，更早的自动删除。

**恢复步骤**（务必先停止容器，避免写盘窗口）：

```bash
docker-compose down
cp data/backups/backup-YYYYMMDD-HHmmss.db data/data.db
docker-compose up -d
```

备份文件与主库 `data/data.db` 同为 SQLite 文件，可直接替换使用。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查，返回 `{ "status": "ok" }` |
| GET | `/api/data` | 获取用户自定义数据（匿名） |
| POST | `/api/data` | 保存用户自定义数据（需 `x-admin-token` 认证，且受写限流保护） |

> 写接口 `POST /api/data` 必须携带 `x-admin-token` 请求头，其值为环境变量 `ADMIN_TOKEN`（长度 >= 16 字符）。
> 缺失或错误返回 `401 {"error":"Unauthorized"}`；写请求超过限流阈值返回 `429 {"error":"Too many requests"}`（附带 `Retry-After` 头）。
> 读接口（`GET /api/data`、`GET /health`、静态资源、首页）保持匿名开放。

自定义数据结构：

```json
{
  "customLinks": {
    "国家机关": [
      { "name": "示例网站", "url": "https://example.com", "custom": true }
    ]
  },
  "customCategories": [
    {
      "name": "我的分类",
      "icon": "star",
      "links": [{ "name": "GitHub", "url": "https://github.com" }]
    }
  ],
  "removedDefaults": ["https://example.com/removed"],
  "categoryOrder": ["我的分类", "国家机关"]
}
```

## CI/CD 自动部署

本项目已配置 GitHub Actions 工作流（`.github/workflows/ci-cd.yml`）：

1. **测试**：每次 Push / PR 自动运行 `npm test`
2. **构建镜像**：测试通过后自动构建 Docker 镜像
3. **推送镜像**：镜像推送到 GitHub Container Registry（`ghcr.io/wangbingquan1991/authority-navigation`），标签为 `latest` 和分支 `master-<short-sha>`
4. **自动部署**（可选）：配置了 SSH 密钥后，推送 `master` 分支会自动登录服务器并拉取最新镜像重启服务

### 启用自动部署

在 GitHub 仓库 `Settings → Secrets and variables → Actions` 中添加以下 secrets：

| Secret | 说明 |
|--------|------|
| `SSH_HOST` | 服务器 IP 或域名 |
| `SSH_USER` | SSH 用户名 |
| `SSH_KEY` | SSH 私钥（建议配置仅允许 docker 命令的受限密钥） |
| `SSH_PORT` | SSH 端口，可选，默认 22 |

服务器端需要提前准备：

```bash
mkdir -p ~/authority-navigation
cd ~/authority-navigation
# 放入 docker-compose.prod.yml 与 data/ 目录
docker-compose -f docker-compose.prod.yml up -d
```

手动部署也可使用脚本：

```bash
bash scripts/deploy.sh
```

### Nginx 反向代理 + HTTPS

准备一个有公网 IP 的服务器，并将域名（例如 `nav.example.com`）解析到该服务器。

1. 在服务器上克隆或放置项目文件：

```bash
mkdir -p ~/authority-navigation
cd ~/authority-navigation
# 复制 docker-compose.nginx.yml、nginx/、scripts/ 到该目录
```

2. 生成 Nginx 配置并申请 Let's Encrypt 证书：

```bash
export DOMAIN=nav.example.com
export EMAIL=your-email@example.com
bash scripts/init-ssl.sh
```

3. 启动完整服务：

```bash
docker-compose -f docker-compose.nginx.yml up -d
```

4. 访问 `https://nav.example.com`

**说明：**

- `scripts/init-ssl.sh` 会先启动一个临时的 HTTP Nginx，用于 Let's Encrypt 的域名验证
- 证书自动续期由 `certbot` 容器每 12 小时检查一次
- 所有 HTTP 请求会自动 301 跳转到 HTTPS
- 数据仍持久化在 `./data/data.db`

## 目录结构

```
authority-navigation/
├── pages/
│   ├── index.html          # 前端页面
│   ├── css/styles.css      # 主题与布局样式
│   └── js/                 # 前端组件与服务
├── assets/                 # Logo 与主题预览图
├── data/                   # SQLite 数据库（运行生成，不提交）
├── tests/
│   └── api.test.js         # API 测试套件
├── scripts/
│   ├── deploy.sh           # 服务器手动部署脚本
│   └── init-ssl.sh         # SSL 证书初始化脚本
├── nginx/
│   ├── authority-navigation.conf.template  # Nginx 配置模板
│   └── authority-navigation.conf           # 生成的 Nginx 配置
├── .github/workflows/
│   └── ci-cd.yml           # GitHub Actions CI/CD
├── server.js               # Express 后端入口
├── db.js                   # SQLite 数据访问层
├── package.json
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
├── docker-compose.nginx.yml
└── README.md
```

## 主题预览

- 抖音暗色：黑色背景 + 品牌红/青强调色
- Claude 浅色：奶油色背景 + 橄榄文字 + 赤陶强调色
- Claude 深色：暖灰背景 + 浅色文字 + 柔和赤陶色
- Apple 浅色：纯白背景 + 深灰文字 + 系统蓝强调色
- Apple 深色：纯黑背景 + 浅灰文字 + 系统蓝强调色

