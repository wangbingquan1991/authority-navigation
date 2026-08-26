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

- 所有用户自定义内容（分类、链接、删除项、类别优先级顺序）都会保存在 `./data/custom-data.json`
- `docker-compose.yml` 已将 `./data` 挂载到容器的 `/app/data`，因此以下操作不会丢失数据：
  - 容器重启
  - 镜像重新构建
  - 升级到新版本
- `data/` 目录已加入 `.gitignore` 与 `.dockerignore`，不会进入镜像或 Git 仓库

> 注意：如果直接用 `docker run` 启动而不挂载卷，容器销毁后数据会丢失。请务必使用 Docker Compose 或手动挂载 `-v $(pwd)/data:/app/data`。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查，返回 `{ "status": "ok" }` |
| GET | `/api/data` | 获取用户自定义数据 |
| POST | `/api/data` | 保存用户自定义数据 |

自定义数据结构：

```json
{
  "customLinks": {
    "分类ID": [
      { "name": "示例网站", "url": "https://example.com" }
    ]
  },
  "customCategories": [
    { "id": "custom-1", "title": "我的分类" }
  ],
  "removedDefaults": ["默认分类ID", "默认链接ID"]
}
```

## 目录结构

```
authority-navigation/
├── pages/
│   └── index.html          # 前端页面
├── assets/                 # 主题预览图
├── data/                   # 用户自定义数据（运行生成，不提交）
├── server.js               # Express 后端入口
├── package.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 主题预览

- 抖音暗色：黑色背景 + 品牌红/青强调色
- Claude 浅色：奶油色背景 + 橄榄文字 + 赤陶强调色
- Claude 深色：暖灰背景 + 浅色文字 + 柔和赤陶色
- Apple 浅色：纯白背景 + 深灰文字 + 系统蓝强调色
- Apple 深色：纯黑背景 + 浅灰文字 + 系统蓝强调色

