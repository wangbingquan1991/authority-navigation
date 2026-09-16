#!/usr/bin/env bash
# ============================================================
# 服务器手动部署脚本
# ============================================================
# 镜像在服务器本地从源码构建，不依赖任何镜像仓库。
# 在服务器上的项目目录内执行：
#   bash scripts/deploy.sh
#
# 可用环境变量：
#   APP_DIR         项目目录，默认 $HOME/authority-navigation
#   COMPOSE_FILE    指定 compose 文件，默认自动探测
#   HEALTH_RETRIES  健康检查重试次数，默认 20
#   HEALTH_INTERVAL 健康检查间隔秒数，默认 3
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/authority-navigation}"
CONTAINER="authority-navigation"
LOCAL_IMAGE="authority-navigation:local"
BACKUP_KEEP_DEPLOY=5

cd "$APP_DIR"

# ---------- 1. 部署前置检查 ----------
# 缺少 ADMIN_TOKEN 时容器会 fail closed 直接退出，若此时替换掉正在运行的
# 容器会造成服务中断，因此必须先中止。
if ! grep -qE '^ADMIN_TOKEN=.+' .env 2>/dev/null; then
  echo "ERROR: $APP_DIR/.env 缺少非空的 ADMIN_TOKEN，已中止部署（现有容器未受影响）。" >&2
  exit 1
fi

# ---------- 2. 选择 docker compose 命令 ----------
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "ERROR: 未找到 docker compose 或 docker-compose" >&2
  exit 1
fi

# ---------- 3. 选择 compose 文件 ----------
if [ -n "${COMPOSE_FILE:-}" ]; then
  :
elif docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}-nginx$"; then
  COMPOSE_FILE="docker-compose.nginx.yml"
elif [ -f docker-compose.prod.yml ]; then
  COMPOSE_FILE="docker-compose.prod.yml"
else
  COMPOSE_FILE="docker-compose.yml"
fi
echo "==> Using: $DC -f $COMPOSE_FILE"

# ---------- 4. 数据留档 ----------
# 文件名附 PID：秒级时间戳在同一秒内会重名覆盖（本脚本也可被连续调用），
# 加 PID 可保证唯一；轮转本身按修改时间排序，不依赖文件名。
if [ -f data/data.db ]; then
  mkdir -p data/backups/deploy
  cp data/data.db "data/backups/deploy/data-$(date +%Y%m%d-%H%M%S)-$$.db"
  ls -1t data/backups/deploy/*.db 2>/dev/null | tail -n +$((BACKUP_KEEP_DEPLOY + 1)) \
    | while read -r old; do rm -f "$old"; done
  echo "==> Data snapshot saved to data/backups/deploy/"
fi

# ---------- 5. 保留上一个镜像便于回滚 ----------
if docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1; then
  docker tag "$LOCAL_IMAGE" authority-navigation:previous
fi

# ---------- 6. 构建并启动 ----------
echo "==> Building image from local source"
$DC -f "$COMPOSE_FILE" up -d --build --remove-orphans

# ---------- 7. 健康检查 ----------
# 重试次数与间隔可用环境变量覆盖（测试时调小，避免长时间等待）
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"

ok=0
for _ in $(seq 1 "$HEALTH_RETRIES"); do
  if docker exec "$CONTAINER" node -e \
    "require('http').get('http://localhost:3000/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" \
    >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep "$HEALTH_INTERVAL"
done

$DC -f "$COMPOSE_FILE" ps

if [ "$ok" != "1" ]; then
  echo "ERROR: 健康检查失败，最近日志如下：" >&2
  docker logs --tail 50 "$CONTAINER" >&2 || true
  exit 1
fi

echo "==> Health check OK"

# ---------- 8. 清理悬空镜像 ----------
docker image prune -f >/dev/null 2>&1 || true

echo "==> Deployment complete"
