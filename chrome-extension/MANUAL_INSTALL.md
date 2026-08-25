# Authority Navigation 扩展 - 手动安装

## 方法 1: 开发者模式 (推荐)

1. 打开 Chrome，访问 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本目录 (`chrome-extension/`)
5. 完成！

## 方法 2: 拖入 .crx

1. 打开 Chrome，访问 `chrome://extensions/`
2. 确保 **开发者模式** 已开启
3. 把 `extension.crx` 文件拖到页面上
4. 点击 **添加扩展程序**

## 方法 3: 企业策略 (需要 sudo)

```bash
sudo bash install-mac.sh
```

这会通过 Chrome 的企业策略机制自动强制安装扩展。

## 验证

安装后:
1. 点击工具栏扩展图标（⚡ 图标）
2. 点击 ⚙️ 设置
3. 填入：
   - **导航页面地址**: `http://localhost:3000`
   - **管理员口令**: `<从服务器 .env 中获取 ADMIN_TOKEN 值>`
   - **保存**
4. 浏览任意网页 → 点击扩展 → 选择分类 → 添加
