#!/bin/bash
# Authority Navigation Chrome 扩展一键安装脚本 (macOS)
# 需要管理员权限 (sudo)

set -e

EXT_ID="lcnpmdkjolhojnobohjabapkagpfifpn"
EXT_NAME="Authority Navigation 一键收藏"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 全部基于当前用户的主目录推导，避免写死某台机器的绝对路径
PKG_DIR="$HOME/Library/Application Support/ChromeExtensionPackages"
CRX_SRC="$PKG_DIR/${EXT_ID}.crx"
# file:// URL 中的空格需转义为 %20
PKG_DIR_URL="file://${PKG_DIR// /%20}"
UPDATE_URL="${PKG_DIR_URL}/update.xml"
POLIST_PATH="/Library/Managed Preferences/com.google.Chrome.plist"

echo "=============================================="
echo "  $EXT_NAME - Chrome 一键安装"
echo "=============================================="
echo ""

# 1. 确保 CRX 存在
if [ ! -f "$CRX_SRC" ]; then
    echo "📦 打包 CRX..."
    mkdir -p "$(dirname "$CRX_SRC")"
    # 用 Chrome 自带的 pack_extension
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if [ -x "$CHROME_BIN" ]; then
        "$CHROME_BIN" --pack-extension="$SCRIPT_DIR" \
                      --pack-extension-key="/tmp/ext-key.pem" \
                      --no-message-box 2>/dev/null || true
        # 移动 .crx 到目标位置
        mv "${SCRIPT_DIR}.crx" "$CRX_SRC" 2>/dev/null || true
        mv "${SCRIPT_DIR}.pem" "$PKG_DIR/${EXT_ID}.pem" 2>/dev/null || true
        echo "✓ CRX 已生成: $CRX_SRC"
    else
        echo "✗ 找不到 Chrome"
        exit 1
    fi
fi

# 2. 创建 update.xml
UPD_DIR="$(dirname "$UPDATE_URL" | sed 's/%20/ /g')"
mkdir -p "$UPD_DIR"
cat > "$UPD_DIR/update.xml" << XMLEOF
<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="$EXT_ID">
    <updatecheck status="ok">
      <urls>
        <url codebase="${PKG_DIR_URL}/${EXT_ID}.crx"/>
      </urls>
      <manifest version="1.0.0"/>
    </updatecheck>
  </app>
</gupdate>
XMLEOF
echo "✓ update.xml 已就绪"

# 3. 创建企业策略 plist (需要 sudo)
echo ""
echo "🔐 需要 sudo 权限来写入 Chrome 企业策略..."

sudo mkdir -p "/Library/Managed Preferences"

# 用 Python 写 plist 更可靠
sudo python3 << PYEOF
import plistlib, os

plist_path = "$POLIST_PATH"

# 读取现有 plist 或创建新的
if os.path.exists(plist_path):
    with open(plist_path, "rb") as f:
        plist = plistlib.load(f)
else:
    plist = {}

# 设置扩展强制安装
plist['ExtensionInstallForcelist'] = [
    "${EXT_ID};${UPDATE_URL}"
]

# 允许所有扩展
plist['ExtensionInstallAllowlist'] = ["*"]

# 写入
with open(plist_path, "wb") as f:
    plistlib.dump(plist, f)

print(f"✓ 企业策略已写入: {plist_path}")
print(f"  ExtensionInstallForcelist: {plist.get('ExtensionInstallForcelist')}")
PYEOF

# 4. 杀掉 Chrome 让策略生效
echo ""
echo "🔄 重启 Chrome..."
killall -9 "Google Chrome" 2>/dev/null || true
sleep 2

echo ""
echo "=============================================="
echo "  ✅ 安装完成！"
echo "=============================================="
echo ""
echo "Chrome 会自动安装扩展: $EXT_NAME"
echo ""
echo "🔧 首次使用:"
echo "  1. 重启 Chrome"
echo "  2. 点击工具栏扩展图标"
echo "  3. ⚙️ 设置 → 填入:"
echo "     导航地址: http://localhost:3000"
echo "     管理员口令: \${ADMIN_TOKEN:-<从服务器 .env 中获取>}"
echo "     保存"
echo "  4. 浏览任意网页 → 点击扩展 → 选择分类 → 添加"
echo ""

# 打开 chrome://extensions/ 确认安装成功
sleep 5
open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || true
