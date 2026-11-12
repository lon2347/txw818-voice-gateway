# TXW818 语音网关全项目规划与 Angular 前端实现方案

本文档基于对 `implement plan/` 目录现有产物（架构文档、部署方案、后端 Node.js 实现代码及数据库脚本）的深度审查，梳理出整套系统的技术现状、接口契约差异、全链路架构，并提出以 **Angular (v18+)** 构建移动端优先（H5）与桌面自适应前端的完整工程实施规划。

---

## 目录
1. [现有产物深度审查与现状分析](#一现有产物深度审查与现状分析)
2. [全项目架构与数据流图谱](#二全项目架构与数据流图谱)
3. [后端接口契约与差异修正分析](#三后端接口契约与差异修正分析)
4. [Angular 前端工程架构方案](#四angular-前端工程架构方案)
5. [核心用户旅程与页面设计 (User Journeys)](#五核心用户旅程与页面设计-user-journeys)
6. [后端规范化整改建议 (Refactoring)](#六后端规范化整改建议-refactoring)
7. [全项目分阶段落地路线图 (Roadmap)](#七全项目分阶段落地路线图-roadmap)
8. [Nginx 与 Docker Compose 生产交付配置](#八nginx-与-docker-compose-生产交付配置)

---

## 一、现有产物深度审查与现状分析

### 1.1 资产盘点

| 路径 | 类别 | 当前状态 | 评估与结论 |
|---|---|---|---|
| `implement plan/前端-后端-网关-支付对接文档.md` | 业务与系统方案 | 完整 | 详细规定了用户鉴权、设备绑定、加油包下单、支付宝支付/回调、Redis 权威余额与 WSS 网关准入全链路。 |
| `implement plan/语音网关部署计划.md` | 运维与架构文档 | 完整 | 规定了腾讯云 CVM（广州 2C4G Ubuntu 22.04）、Docker Compose 容器隔离与内存上限、安全组策略。 |
| `implement plan/backend/` | 业务后端代码 | 逻辑基本就绪，但文件命名存在双后缀异常 | 采用 Node.js + Express + mysql2 + ioredis 实现。存在 `server.js.js`、`auth.js.js`、`02_backend_schema.sql.sql` 等双后缀问题，且代码路由与文档存在细微差异。 |
| `implement plan/frontend/` | 前端工程目录 | **仅有说明文档，无实际代码** | 包含 `交付内容.docx`（原为 Vue 3 + Vite 的构想方案说明）。当前无任何前端代码，为使用 **Angular** 打造纯净、企业级前端工程提供了最佳切入点。 |

### 1.2 关键业务与技术原则
1. **形态定位：移动端 H5 优先，兼顾 PC 桌面**：
   * 终端用户核心操作（如扫描硬件贴纸上的二维码进入绑定）基本发生在手机端（微信或手机浏览器），前端需采用 Mobile-first 布局，在桌面端以居中卡片容器（Mobile Frame Container）呈现。
   * 不做原生 App，规避应用商店审核上架周期与资质壁垒。
2. **密钥安全红线（三不原则）**：
   * 阿里云短信 AccessKey / 支付宝应用私钥 / 腾讯云语音 SecretKey **严格封闭在后端与网关容器中**（环境变量读取）。
   * 前端、二维码参数、设备固件绝不包含任何敏感密钥。
3. **资金与额度权威归属**：
   * 金额与时长权威：**只信后端数据库 `pkg` 表**，前端仅提交套餐 ID (`pkg_id`)。
   * 余额权威：加余额只能在**支付宝异步回调验签通过且业务校验通过**后触发，Redis (`voice:balance:user:{uid}`) 作为实时扣费权威，MySQL (`wallet_user`) 作为持久化快照。

---

## 二、全项目架构与数据流图谱

```
                          用户终端（微信 / 手机浏览器 / PC）
                                         │
                         https://api.yourdomain.com (443)
                                         │
                             ┌───────────┴───────────┐
                             │         Nginx         │ TLS 终结 / 静态代理 / WSS 升级
                             └───────────┬───────────┘
               ┌─────────────────────────┼─────────────────────────┐
               ▼                         ▼                         ▼
        Angular 前端 (SPA)         业务后端 (API)              语音网关 (WSS)
        静态资源 / HTML5           Node.js 9100               Go/Node 8080
        - /login 短信登录          - /api/auth/*              - /v1/voice/stream
        - /bind 扫码绑定           - /api/devices/*                 │
        - /recharge 选套餐         - /api/orders/*                  │ (代持密钥转发)
        - /pay/result 支付回跳     - /api/wallet & bills            ▼
        - /wallet 个人中心         - /pay/alipay/notify       腾讯云语音大模型
               │                         │                 (Speech-to-Speech)
               │                         ▼                          │
               │             ┌────────────────────────┐             │
               └────────────►│ MySQL (用户/设备/订单)  │◄────────────┘
                             │ Redis (实时权威余额/锁) │
                             └────────────────────────┘
```

---

## 三、后端接口契约与差异修正分析

在审查 `implement plan/backend/` 中的源码时，发现其实现的实际路由与 `前端-后端-网关-支付对接文档.md` 存在部分命名与方法差异。Angular 前端服务需基于**实际后端代码**进行契约对齐：

### 3.1 统一接口响应规范
所有接口返回标准 JSON 结构：
```typescript
export interface ApiResponse<T = any> {
  code: number; // 0 表示成功，非 0 表示业务异常
  msg: string;
  data: T;
}
```

### 3.2 接口详细清单与比对

| 业务模块 | 接口路径 (实际代码) | 请求方法 | 鉴权要求 | 载荷参数 / 返回数据 | 文档原定义差异说明 |
|---|---|---|---|---|---|
| **短信发送** | `/api/auth/sms/send` | `POST` | 公开 | Body: `{ phone: string }`<br>Resp: `{ debugCode?: string }` | 一致，开发环境支持回显 `debugCode` |
| **短信验证登录** | `/api/auth/sms/verify` | `POST` | 公开 | Body: `{ phone: string, code: string }`<br>Resp: `{ token: string, user: { id: number, phone: string } }` | 一致，返回 JWT 凭证，有效期 7 天 |
| **一键登录** | `/api/auth/oneclick` | `POST` | 公开 | 预留接口，返回 5010 | 暂不做，走短信登录兜底 |
| **设备扫码解析** | `/api/devices/resolve` | `POST` | 公开 | Body: `{ device_id: string }`<br>Resp: `{ device_id, bound: boolean, status }` | **文档为 GET query，代码实现为 POST json** |
| **执行设备绑定** | `/api/devices/bind` | `POST` | JWT 鉴权 | Body: `{ device_id: string }`<br>Resp: `{ device_id: string }` | 一致 |
| **我的设备列表** | `/api/devices` | `GET` | JWT 鉴权 | Resp: `Array<{ device_id, status, created_at }>` | 一致 |
| **加油包列表** | `/api/orders/packages` | `GET` | 公开 | Resp: `Array<{ id, name, minutes, price }>` | **文档为 `/api/pkg/list`，代码为 `/api/orders/packages`** |
| **创建订单下单** | `/api/orders` | `POST` | JWT 鉴权 | Body: `{ pkg_id: number }`<br>Resp: `{ order_no: string, pay_url: string }` | 适配 **Vibe Pay (支付宝AI付)**：手机端自适应 `alipay.trade.wap.pay` (唤起支付宝 App)，PC端使用 `alipay.trade.page.pay` |
| **订单状态轮询** | `/api/orders/:orderNo` | `GET` | JWT 鉴权 | Resp: `{ order_no, status: 'pending'\|'paid', paid_at }` | 一致 |
| **钱包时长查询** | `/api/wallet` | `GET` | JWT 鉴权 | Resp: `{ balance_sec: number }` | 一致 |
| **账单流水查询** | `/api/bills` | `GET` | JWT 鉴权 | Resp: `{ orders: PurchaseOrder[], bills: VoiceSession[] }` | **文档为 `/api/bill/list`，代码整合为 `/api/bills`** |
| **支付宝异步通知**| `/pay/alipay/notify` | `POST` | 支付宝直连 | Form-urlencoded 验签与流水入库 | 前端不直连该接口 |

---

## 四、Angular 前端工程架构方案

采用 **Angular 18+ (Standalone Components + Signals)** 架构，结合 **Tailwind CSS**，打造兼具体积小、加载快、移动端手感出色的现代化 Web 应用。

### 4.1 目录组织规划

```
frontend/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts               # 路由守卫：登录态校验与跳转拦截
│   │   │   ├── interceptors/
│   │   │   │   └── auth.interceptor.ts         # HTTP 拦截器：注入 JWT、捕获 401 并踢回登录
│   │   │   ├── models/
│   │   │   │   ├── api.model.ts                # ApiResponse, ErrorCode 定义
│   │   │   │   ├── auth.model.ts               # User, Token, LoginState
│   │   │   │   ├── device.model.ts             # DeviceInfo, ResolveStatus
│   │   │   │   ├── order.model.ts              # Package, OrderResult, PayStatus
│   │   │   │   └── wallet.model.ts             # WalletBalance, OrderBill, VoiceBill
│   │   │   └── services/
│   │   │       ├── api.service.ts              # 基础 HTTP 请求封装
│   │   │       ├── auth.service.ts             # 用户状态管理（基于 Signal）
│   │   │       ├── device.service.ts           # 设备解析、绑定与列表拉取
│   │   │       ├── order.service.ts            # 套餐获取、下单与轮询服务
│   │   │       ├── wallet.service.ts           # 余额实时刷新与账单记录
│   │   │       └── toast.service.ts            # 轻量级移动端 Toast 提示服务
│   │   ├── shared/
│   │   │   ├── components/
│   │   │   │   ├── app-shell.component.ts      # 移动端容器（PC 端自动居中卡片展示）
│   │   │   │   ├── header.component.ts         # 顶部标题栏 + 返回键 + 状态展示
│   │   │   │   ├── toast.component.ts          # 全局 Toast 浮层
│   │   │   │   └── countdown-btn.component.ts  # 60 秒短信验证码倒计时按钮
│   │   │   └── pipes/
│   │   │       ├── duration.pipe.ts            # 秒数换算：如 3660 秒 -> 1小时1分钟
│   │   │       └── currency-cny.pipe.ts        # 金额格式化（¥XX.XX）
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   └── login/login.component.ts    # 手机号 + 验证码快速登录
│   │   │   ├── device/
│   │   │   │   ├── bind/bind.component.ts      # 扫码直达页（解析 device_id 并一键绑定）
│   │   │   │   └── list/device-list.component.ts # 我的已绑设备管理
│   │   │   ├── recharge/
│   │   │   │   ├── recharge.component.ts       # 加油包套餐展示与支付宝结账触发
│   │   │   │   └── pay-result.component.ts     # 支付完成回跳页（自动轮询到账动画）
│   │   │   └── wallet/
│   │   │       └── wallet.component.ts         # 账户余额、充值记录与语音会话流水
│   │   ├── app.routes.ts                       # 路由映射表
│   │   ├── app.config.ts                       # 全局依赖注入配置 (provideHttpClient 等)
│   │   └── app.component.ts                    # 根组件
│   ├── assets/                                 # 静态图片、图标与硬件示意图
│   ├── styles.css                              # Tailwind 指令与全局样式定义
│   └── index.html                              # Viewport 移动端视口与防缩放配置
├── angular.json
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

### 4.2 状态管理：基于 Angular Signals 的轻量流转
无需引入厚重的 NgRx 或状态库，直接采用 Angular 核心的 `signal` 和 `computed`：
* `AuthService.token = signal<string | null>(localStorage.getItem('token'))`
* `AuthService.isLoggedIn = computed(() => !!this.token())`
* `WalletService.balanceSeconds = signal<number>(0)`
* `WalletService.balanceMinutes = computed(() => Math.floor(this.balanceSeconds() / 60))`

---

## 五、核心用户旅程与页面设计 (User Journeys)

### 旅程 1：扫码绑定设备（核心入口）
```
设备贴纸二维码 (https://api.yourdomain.com/bind?device_id=TXW818-ABC123)
       │
       ▼
Angular 路由解析到 `/bind`，提取 queryParam: `device_id`
       │
       ├─► 调 `POST /api/devices/resolve` 查设备状态
       │     ├─ 设备不存在 -> Toast 错误提示
       │     └─ 设备存在并展示型号
       │
       ├─► 检查本地登录态 (`AuthService.isLoggedIn`)
       │     ├─ 未登录 -> 记录当前完整 URL 为 redirectUrl，自动跳转 `/login`
       │     │           (登录成功后自动回跳回 `/bind?device_id=...`)
       │     └─ 已登录 -> 激活 "确认绑定该设备" 按钮
       │
       ▼
点击 "确认绑定" -> 调 `POST /api/devices/bind`
       │
       └─► 绑定成功 -> 引导进入 `/recharge` 购买时长或 `/wallet` 查看状态
```

### 旅程 2：短信验证码登录
1. 界面极简纯净：手机号输入框（正则严格检验：`^1[3-9]\d{9}$`）+ 短信验证码输入框 + 获取验证码倒计时组件。
2. 倒计时组件 `CountdownBtn`：点击后调 `/api/auth/sms/send`，进入 60 秒冷却；开发环境下若接口返回 `debugCode`，支持一键填入方便调试。
3. 提交登录：调用 `/api/auth/sms/verify`，后端颁发 JWT。前端存入 `localStorage`，刷新登录态，并完成路由回跳。

### 旅程 3：购买加油包与支付宝结账
1. 进入 `/recharge`，自动拉取 `/api/orders/packages`，展示套餐卡片（如：60分钟 ¥9.9、300分钟 ¥39.9、1000分钟 ¥99）。
2. 用户点击套餐卡片 -> 调 `POST /api/orders`，后端返回 `{ order_no, pay_url }`。
3. 前端将 `order_no` 暂存至 `sessionStorage`，执行 `window.location.href = pay_url` 唤起支付宝付款。

### 旅程 4：支付回跳与到账轮询
1. 用户在支付宝支付完毕后，支付宝通过 `return_url` 自动回跳至前端 `/pay/result?out_trade_no=xxx`。
2. 前端展示 "正在确认到账中..." 动效，启动轮询定时器（每 2.5 秒一次，最大轮询 12 次 / 30 秒）：
   * 调 `GET /api/orders/:orderNo`。
   * 当状态变为 `paid` 时，停止轮询，播放成功动效，自动触发 `walletService.refresh()` 刷新余额。
   * 点击按钮直达 `/wallet` 查看到账时长。

### 旅程 5：钱包与使用流水
1. 顶部卡片大字展示剩余可用时长（如：`3 小时 45 分钟`），支持下拉或点击刷新。
2. Tab 切换：
   * **充值订单记录**：展示历史购买的套餐名称、支付金额、时间与状态。
   * **通话扣费流水**：展示设备最近每次语音交互会话扣除的秒数与起始时间。

---

## 六、后端规范化整改建议 (Refactoring)

当前 `implement plan/backend/` 下存在以下可优化的细节，建议在前端工程搭建的同时完成规整：

1. **修正文件双后缀名**：
   * `server.js.js` -> `src/server.js`
   * `lib.js.js` -> `src/lib.js`
   * `auth.js.js` -> `src/routes/auth.js`
   * `device.js.js` -> `src/routes/device.js`
   * `order.js.js` -> `src/routes/order.js`
   * `wallet.js.js` -> `src/routes/wallet.js`
   * `pay.js.js` -> `src/routes/pay.js`
   * `02_backend_schema.sql.sql` -> `db/02_backend_schema.sql`
   * `docker-compose.override.yml.yml` -> `docker-compose.override.yml`
2. **路由结构整理**：
   保证 `package.json` 中的 `"main": "src/server.js"` 与目录结构完全一致，便于容器打包。

---

## 七、全项目分阶段落地路线图 (Roadmap)

```
阶段一：后端与基础架构规整 (Backend Cleanup & Alignment) [已完成]
├── [x] 修复 backend 目录下重复后缀文件，规范放入 src/ 与 db/
├── [x] 验证 package.json 与 node src/server.js 启动流程
├── [x] 补充 .env.example, Dockerfile, nginx/backend.locations.conf
└── [x] 成功执行 npm install 并跑通 npm run check

阶段二：Angular 前端基建与骨架搭建 (Frontend Scaffolding) [已完成]
├── [x] 初始化 Angular 18 Standalone 前端工程 (无 NgModule，精简现代化)
├── [x] 配置 Tailwind CSS 与 Mobile-first 移动端视口 (index.html, styles.css)
├── [x] 封装 Core 模块：
│   ├── [x] Models（api.model.ts, auth.model.ts, device.model.ts, order.model.ts, wallet.model.ts）
│   ├── [x] AuthInterceptor（JWT 注入、401 自动登出与友好提示）
│   ├── [x] AuthGuard（函数式路由守卫与 returnUrl 记忆）
│   └── [x] ToastService（基于 Signal 的全局响应式消息轻提示）
└── [x] 实现 Shared 布局组件：AppShellComponent（移动端壳与桌面居中卡片展示）

阶段三：业务功能逐模块开发 (Features Implementation) [已完成]
├── [x] 模块 1：Auth 认证模块（LoginComponent：手机号校验、60s 倒计时组件、验证码登录）
├── [x] 模块 2：Device 设备绑定模块（BindDeviceComponent：URL 参数识别、状态解析、绑定确认；DeviceListComponent：我的设备列表）
├── [x] 模块 3：Recharge 充值模块（RechargeComponent：套餐列表、单选下单跳支付宝；PayResultComponent：支付结果 12 次异步轮询）
├── [x] 模块 4：Wallet 个人中心模块（WalletComponent：精确秒级权威余额与时分换算、充值记录、通话扣费流水）
└── [x] 成功执行 npm run build，生产包体优化至 ~84 kB

阶段四：Docker 容器化与 Nginx 生产集成 (Deployment Integration) [已完成]
├── [x] 编写前端 Multi-stage Dockerfile（Node 构建 + 极轻量 Nginx 托管）及 .dockerignore
├── [x] 编写后端 Dockerfile、.dockerignore 及 .env 默认配置
├── [x] 编写语音网关 Gateway WebSocket 服务端与 Dockerfile
├── [x] 配置 Nginx 反代网关 (nginx.conf, conf.d/default.conf, common_proxy.inc) 支持 WSS Upgrade 与 Gzip
├── [x] 生成本地开发测试自签名 SSL 证书 (certs/fullchain.pem, certs/privkey.pem)
├── [x] 编写数据库初始化 01_base_schema.sql 与 02_backend_schema.sql，挂载即自动建库建表
├── [x] 编写完整全栈编排 docker-compose.yml（frontend, backend, gateway, mysql, redis, nginx）
├── [x] 编写一键化构建运维脚本 deploy.sh (up / down / logs / restart)
└── [x] 通过 docker compose config 严谨语法与拓扑校验

阶段五：端到端联调与上线验证 (E2E Verification) [待执行]
├── [ ] 短信发送与登录联调
├── [ ] 扫码绑定端到端闭环验证
├── [ ] 支付宝沙箱/真实小额支付与回调发放验证
└── [ ] 网关基于 Redis 余额放行与扣费实测
```

---

## 八、Nginx 与 Docker Compose 生产交付配置

### 8.1 Nginx 核心配置段 (`nginx/nginx.conf`)
生产环境下将 Angular 构建输出的 `dist/` 直接由 Nginx 承载，并配置路由回退与长连接支持：

```nginx
server {
  listen 80;
  server_name api.yourdomain.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name api.yourdomain.com;

  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;

  # 1) Angular 前端单页应用
  location / {
    root /usr/share/nginx/html;
    index index.html;
    try_files $uri $uri/ /index.html;   # Angular HTML5 路由回退支持
  }

  # 2) 业务后端 API
  location /api/ {
    proxy_pass http://backend:9100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # 3) 支付宝异步回调（公网免重定向、免鉴权直达）
  location = /pay/alipay/notify {
    proxy_pass http://backend:9100;
    proxy_set_header Host $host;
  }

  # 4) 语音网关 WSS 长连接
  location /v1/voice/ {
    proxy_pass http://gateway:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
  }
}
```

---
*规划文档已就绪。后续开发将严格按照此设计契约分阶段实施。*

