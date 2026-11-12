# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build -- --configuration production

# 生产运行阶段：极轻量 Nginx 托管
FROM nginx:alpine

# 拷贝 Angular 生产构建产物
COPY --from=builder /app/dist/voice-frontend/browser /usr/share/nginx/html

# Nginx 单页应用路由回退配置
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

