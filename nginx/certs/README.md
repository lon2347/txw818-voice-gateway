# Nginx SSL 证书目录说明

本目录预置了自签名的开发测试证书 (`fullchain.pem` 和 `privkey.pem`)，用于确保 Docker 容器在本地或初次上线部署时能够平滑启动并监听 443 端口。

## 生产环境替换步骤 (腾讯云 CVM / 域名上线)

1. **腾讯云免费 SSL 证书**：
   在腾讯云控制台申请免费 SSL 证书（TrustAsia DV SSL），下载 Nginx 版本 zip 包，将解压后的 `.crt`（或 `.pem`）重命名为 `fullchain.pem`，将 `.key` 重命名为 `privkey.pem` 覆盖本目录同名文件。

2. **或使用 Let's Encrypt / Certbot 自动化证书**：
   ```bash
   sudo certbot certonly --standalone -d api.yourdomain.com
   # 复制或软链至本目录
   cp /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem ./fullchain.pem
   cp /etc/letsencrypt/live/api.yourdomain.com/privkey.pem ./privkey.pem
   ```

3. 重载 Nginx：
   ```bash
   docker compose exec nginx nginx -s reload
   ```

