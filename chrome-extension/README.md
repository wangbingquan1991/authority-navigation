# Authority Navigation Chrome 扩展

一键将当前浏览的网页添加到 Authority Navigation 导航页面。

## 功能特性

- **一键收藏**：点击浏览器工具栏图标，自动获取当前页面的标题和网址
- **丰富元数据**：通过 Content Script 提取页面 OG 标题、描述、Favicon、选中文本等
- **智能分类**：支持添加到已有分类，也支持快速创建新分类
- **连接测试**：内置连接测试功能，一键验证服务器可达性和 Token 正确性
- **安全存储**：使用 `chrome.storage.local` 存储服务器地址和 Token

## 文件结构

```
chrome-extension/
├── manifest.json      # 扩展配置 (Manifest V3)
├── popup.html         # 弹出界面
├── popup.css          # 样式
├── popup.js           # 核心逻辑
├── content.js         # 内容脚本 - 提取页面元数据
├── background.js      # Service Worker
├── icons/             # 图标文件
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 安装步骤

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `chrome-extension` 目录
5. 扩展图标将出现在浏览器工具栏

## 配置说明

1. 点击工具栏上的扩展图标
2. 点击右上角的 ⚙️ 设置按钮
3. 填写 **导航页面地址**（Authority Navigation 服务器地址，如 `https://your-nav-site.com`）
4. 填写 **管理员口令**（即服务器的 `ADMIN_TOKEN` 环境变量值）
5. 点击 **测试连接** 验证配置是否正确
6. 点击 **保存**

## 使用方法

1. 浏览任意网页
2. 点击浏览器工具栏的扩展图标
3. 确认自动填充的名称和网址（可编辑）
4. 从下拉菜单选择目标分类，或点击 **+** 新建分类
5. 点击 **添加到导航** 按钮
6. 查看导航页面确认链接已添加

## 后端 API 对接

扩展通过以下 API 与 Authority Navigation 服务器通信：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/config` | GET | 获取默认分类配置 |
| `/api/data` | GET | 获取当前数据 |
| `/api/data` | POST | 写入数据（需 `x-admin-token` 头） |

### 数据格式

```json
{
  "customLinks": {
    "默认分类名": [
      { "name": "链接名称", "url": "https://...", "custom": true }
    ]
  },
  "customCategories": [
    {
      "name": "自定义分类",
      "icon": "M12 2v20 M2 12h20",
      "links": [{ "name": "...", "url": "...", "custom": true }]
    }
  ],
  "removedDefaults": [],
  "categoryOrder": []
}
```

## 开发说明

### Content Script 通信流程

```
Popup ──chrome.tabs.sendMessage──▶ Content Script
                                    │
                                    ├── 提取页面元数据
                                    └── 返回 { title, url, favicon, description, selectedText, siteName }
Popup ◀──chrome.runtime.onMessage── Content Script
```

### 不支持的页面

以下页面类型无法注入 Content Script，会降级使用 Chrome Tabs API：
- `chrome://` 内部页面
- `chrome-extension://` 扩展页面
- `edge://`, `brave://`, `devtools://` 等
- `file://` 本地文件

### 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 存储服务器地址和 Token |
| `tabs` | 获取当前活动标签页信息 |
| `scripting` | 支持脚本注入（预留） |
| `<all_urls>` | Content Script 在所有页面运行 |

## 测试后端启动

```bash
cd authority-navigation
ADMIN_TOKEN=your-secret-token-here PORT=3000 node server.js
```

访问 `http://localhost:3000` 查看导航页面。

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| 扩展图标不显示 | 在 `chrome://extensions/` 重新加载扩展 |
| 连接测试失败 | 检查服务器地址是否以 `http://` 或 `https://` 开头 |
| 401 Unauthorized | 确认管理员口令与服务器 `ADMIN_TOKEN` 一致 |
| 429 Too Many Requests | 写入过于频繁，请稍后重试 |
| 分类加载失败 | 确认服务器正在运行，且 `/api/data` 可访问 |
