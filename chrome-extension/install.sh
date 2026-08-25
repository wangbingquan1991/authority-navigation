#!/bin/bash
# ============================================
# Authority Navigation 扩展 - 一键安装脚本
# ============================================

EXT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$EXT_DIR")"

echo ""
echo "============================================"
echo "  Authority Navigation Chrome 扩展安装"
echo "============================================"
echo ""

# 1. 检查扩展文件
if [ ! -f "$EXT_DIR/manifest.json" ]; then
    echo "❌ 扩展文件缺失: manifest.json"
    exit 1
fi
echo "✓ 扩展文件完整"

# 2. 启动后端服务器
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
    if [ -z "${ADMIN_TOKEN:-}" ]; then
        echo "❌ 需要设置 ADMIN_TOKEN 环境变量才能启动后端"
        echo "   用法: ADMIN_TOKEN=<你的令牌> bash install.sh"
        exit 1
    fi
    echo "🚀 启动后端服务器..."
    (cd "$BACKEND_DIR" && ADMIN_TOKEN="$ADMIN_TOKEN" PORT=3000 node server.js &)
    sleep 2
fi
echo "✓ 后端服务器: http://localhost:3000"
if [ -n "${ADMIN_TOKEN:-}" ]; then
    echo "✓ ADMIN_TOKEN 已从环境变量加载"
fi

# 3. 打开 Chrome 扩展管理页
echo ""
echo "👉 正在打开 chrome://extensions/"
open -a "Google Chrome" "chrome://extensions/"

# 4. 打开导航页面作为参考
sleep 1
open -a "Google Chrome" "http://localhost:3000"

echo ""
echo "============================================"
echo "  接下来需要您手动完成 2 步操作："
echo "============================================"
echo ""
echo "  ① 在 chrome://extensions/ 页面"
echo "     右上角开启「开发者模式」开关"
echo ""
echo "  ② 点击「加载已解压的扩展程序」按钮"
echo "     选择此目录："
echo ""
echo "     $EXT_DIR"
echo ""
echo "============================================"
echo "  扩展加载后配置："
echo "============================================"
echo ""
echo "  点击浏览器工具栏上的扩展图标 → ⚙️ 设置"
echo "  导航页面地址: http://localhost:3000"
echo "  管理员口令:   \$(从服务器 .env 中获取 ADMIN_TOKEN 值)"
echo ""
echo "============================================"