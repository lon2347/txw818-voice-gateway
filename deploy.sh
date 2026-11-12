#!/usr/bin/env bash
# ==============================================================================
# TXW818 语音网关全栈一键部署脚本
# 适用环境: 本地开发测试 / 腾讯云 CVM (Ubuntu 22.04)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "  TXW818 语音网关全栈服务启动部署"
echo "=========================================================="

# 1. 检查 Docker 与 Compose
if ! command -v docker &> /dev/null; then
  echo "错误: 未检测到 docker 命令，请先安装 Docker!"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  echo "错误: 未检测到 docker compose 插件，请升级 Docker Compose (v2)!"
  exit 1
fi

# 2. 检查 backend/.env 配置文件
if [ ! -f "backend/.env" ]; then
  echo "[提示] backend/.env 不存在，正在从 .env.example 自动复制..."
  cp backend/.env.example backend/.env
fi

# 3. 检查 Nginx SSL 证书
if [ ! -f "nginx/certs/fullchain.pem" ] || [ ! -f "nginx/certs/privkey.pem" ]; then
  echo "[提示] nginx/certs 缺失证书，正在生成开发自签名证书..."
  mkdir -p nginx/certs
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout nginx/certs/privkey.pem -out nginx/certs/fullchain.pem \
    -subj "/C=CN/ST=Guangdong/L=Guangzhou/O=VoiceGateway/CN=api.yourdomain.com"
fi

# 4. 执行构建与启动
ACTION="${1:-up}"

case "$ACTION" in
  up|start)
    echo ">> 正在构建镜像并启动容器 (后台运行)..."
    docker compose up -d --build
    echo ""
    echo ">> 当前服务运行状态:"
    docker compose ps
    echo ""
    echo "=========================================================="
    echo "  全栈服务已成功就绪!"
    echo "  - 前端 Web 访问:   http://localhost 或 https://localhost"
    echo "  - 后端健康检测:    http://localhost/healthz"
    echo "  - 扫码绑定直达:    http://localhost/bind?device_id=TXW818-ABC123"
    echo "  - 网关 WSS 端点:   ws://localhost/v1/voice/stream"
    echo "=========================================================="
    ;;

  stop|down)
    echo ">> 正在停止全栈服务..."
    docker compose down
    ;;

  restart)
    echo ">> 正在重启全栈服务..."
    docker compose restart
    ;;

  logs)
    docker compose logs -f "${2:-}"
    ;;

  status|ps)
    docker compose ps
    ;;

  *)
    echo "用法: $0 {up|down|restart|logs [service]|status}"
    exit 1
    ;;
esac

