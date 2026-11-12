# 1) Angular 前端单页应用静态托管 / 反向代理
location / {
    proxy_pass http://frontend:80;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 2) 业务后端 API（用户/登录/设备/订单/钱包）
location /api/ {
    proxy_pass http://backend:9100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 3) 支付宝异步通知回调（必须公网直连 POST，不加鉴权与重定向）
location = /pay/alipay/notify {
    proxy_pass http://backend:9100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 4) TXW818 语音网关 WSS 长连接（支持 WebSocket Upgrade 和防超时断开）
location /v1/voice/ {
    proxy_pass http://gateway:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}

