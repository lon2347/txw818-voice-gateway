# TXW818 语音网关 —— Angular 前端应用

基于 **Angular 18+ (Standalone Components + Signals)** 和 **Tailwind CSS** 构建的移动端优先（H5）与桌面自适应前端 Web 应用。

---

## 一、技术特性

- **现代架构**：全 Standalone 组件，无 NgModule 样板代码，采用 Angular Signals 实现细粒度响应式状态管理。
- **极小体积**：生产构建 Initial Transfer 仅 **~84 kB**，全业务模块均配置路由懒加载（Code-splitting）。
- **移动端优先**：针对手机扫码交互深度优化，防误触、支持安全区（`viewport-fit=cover`）；在 PC 桌面端自动呈现精致居中的移动卡片画框（`max-w-md`）。
- **统一拦截与鉴权**：
  - `authInterceptor`: 自动在请求头附加 `Authorization: Bearer <JWT>`，401 自动清空登录态并友好重定向至登录页。
  - `authGuard`: 函数式路由守卫，保护 `/devices` 与 `/wallet` 等敏感页面。
- **本地代理联调**：预置 `proxy.conf.json`，本地启动时自动将 `/api` 与 `/pay` 反向代理至业务后端 `http://127.0.0.1:9100`。

---

## 二、路由与页面对应关系

| 路由路径 | 页面组件 | 鉴权要求 | 功能说明 |
|---|---|---|---|
| `/login` | `LoginComponent` | 公开 | 手机号正则校验 + 60s 倒计时短信验证码登录，支持开发模式下 `debugCode` 自动回显填入。 |
| `/bind` | `BindDeviceComponent` | 公开（绑定需登录） | 手机扫设备二维码直达（自动提取 URL 参数 `?device_id=...`），支持出厂状态核验与一键绑定。 |
| `/devices` | `DeviceListComponent` | **需登录** | 查看当前用户已绑定的硬件列表及出厂状态，提供新增设备入口。 |
| `/recharge` | `RechargeComponent` | **需登录** | 拉取加油包列表（60/300/1000分钟），单选下单直跳支付宝（Alipay / Vibe Pay）。 |
| `/pay/result`| `PayResultComponent` | 公开/需登录 | 支付回跳展示页，自动开启 12 次 (30秒) 状态轮询 (`/api/orders/:orderNo`)，状态变 `paid` 播放入账动效。 |
| `/wallet` | `WalletComponent` | **需登录** | 账户中心：精准展示秒级权威余额与时分换算，支持手动刷新，提供充值记录与语音会话扣费流水 Tab。 |

---

## 三、快速开始

### 1. 本地开发与联调
```bash
cd "implement plan/frontend"

# 安装依赖（若首次运行）
npm install

# 启动开发服务器（默认端口 4200，并挂载 proxy 转发后端 9100）
npm start
```
打开浏览器访问：`http://localhost:4200`

### 2. 生产环境构建
```bash
npm run build
```
构建产物输出位于：`dist/voice-frontend/browser`，可直接交由宿主机 Nginx 承载托管。

### 3. Docker 容器化构建
```bash
# 构建镜像
docker build -t voice-frontend:latest .

# 单独启动测试
docker run -d -p 80:80 voice-frontend:latest
```
