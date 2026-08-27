#!/usr/bin/env bash
set -e

APP_DIR="${APP_DIR:-$HOME/authority-navigation}"
IMAGE="ghcr.io/wangbingquan1991/authority-navigation:latest"

echo "==> Pulling latest image: $IMAGE"
docker pull "$IMAGE"

echo "==> Restarting container"
cd "$APP_DIR"
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d

echo "==> Cleaning up old images"
docker image prune -f

echo "==> Deployment complete"
