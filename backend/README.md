# voice-backend（业务后端）

backend 负责 **登录 / 设备绑定 / 下单 / 支付回调验签 / 权益发放**；gateway 只管 WSS 接入 + 鉴权 + 扣费 + 转发腾讯上游。两者共用同一套 MySQL / Redis。
本目录是接在 `voice-gateway-deploy/` 脚手架之上的新增服务，Node.js + Express + mysql2 + ioredis，最小可运行。

## 目录结构

```
backend/
  package.json
  Dockerfile
  .env.example                 # 复制成 backend/.env 填密钥，勿提交 git
  db/02_backend_schema.sql     # 在 01_schema.sql 之后执行的增量迁移
  nginx/backend.locations.conf # 贴进 nginx.conf 的 server{} 里
  docker-compose.override.yml  # 与主 compose 同目录自动合并
  src/
    server.js                  # 入口，监听 9100（仅内网）
    lib.js                     # MySQL/Redis/JWT/统一响应/支付宝签名验签
    routes/
      auth.js                  # 短信验证码登录 + 一键登录预留
      device.js                # 扫码 resolve + 绑定 + 我的设备
      order.js                 # 套餐列表 + 下单 + 订单轮询
      wallet.js                # 余额 + 账单
      pay.js                   # 支付宝异步回调（验签→幂等→事务发放）
```

## 接口一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | /api/auth/sms/send | 公开 | 发送登录验证码（短信兜底） |
| POST | /api/auth/sms/verify | 公开 | 校验验证码并登录，返回 JWT |
| POST | /api/auth/oneclick | 公开 | 阿里云号码认证一键登录（预留位） |
| POST | /api/devices/resolve | 公开 | 扫码后按 device_id 查设备与绑定状态 |
| POST | /api/devices/bind | JWT | 绑定设备到当前用户 |
| GET  | /api/devices | JWT | 我的设备列表 |
| GET  | /api/orders/packages | 公开 | 加油包列表 |
| POST | /api/orders | JWT | 下单，返回支付宝跳转 pay_url |
| GET  | /api/orders/:orderNo | JWT | 轮询订单状态（前端支付后轮询到 paid） |
| GET  | /api/wallet | JWT | 剩余可用秒数 |
| GET  | /api/bills | JWT | 购买记录 + 语音会话扣费流水 |
| POST | /pay/alipay/notify | 支付宝回调 | 验签→业务校验→SETNX幂等→事务发放→返回 success |

统一响应：`{ code, msg, data }`，`code=0` 成功；`401` 未登录。

## 与网关的衔接（关键一条）

支付成功后 backend 会 `grantPaidOrder` 加余额，再 `syncBalanceToRedis` 把权威余额写进
`voice:balance:user:{uid}`。设备连 WSS 时，**gateway 读这个键判余额**：>0 放行按秒扣费，=0 返回 402。
backend 与 gateway 对 Redis 键名、扣费口径必须完全一致（沿用对接文档第三/五节）。

## 部署步骤

1. 先执行数据库迁移（在已有 01_schema 之后）：
   ```bash
   mysql -uvoice -p voice_gateway < backend/db/02_backend_schema.sql
   ```
   注意：`ALTER ... ADD COLUMN` 若列已存在会报 duplicate column，忽略该行即可。
   确认 `pkg` 表有 name/minutes/price/on_sale 列（见迁移脚本第 7 条注释），
   `purchase_order.status` 支持 pending/paid。
2. 配置密钥：`cp backend/.env.example backend/.env`，填 DB/Redis/JWT/阿里云/支付宝。
   三类密钥（阿里云 AccessKey、支付宝私钥/公钥、腾讯 SecretKey）只留在后端进程，绝不下发前端或设备。
3. 把 `docker-compose.override.yml` 放到 `voice-gateway-deploy/` 主 compose 同目录（自动合并）。
4. 把 `nginx/backend.locations.conf` 贴进 `nginx/nginx.conf` 的 `server{}`，`reload`。
5. 构建并起服务：
   ```bash
   cd voice-gateway-deploy
   docker compose up -d --build backend
   docker compose logs -f backend
   ```

## 支付宝 / Vibe Pay 接入要点 (个人开发者友好)

- 本系统已原生针对 **Vibe Pay (支付宝AI付 - 个人开发者专属收款产品)** 进行适配，个人实名支付宝即可开通，**无需企业营业执照**。
- 详细开通入驻指引见：[VIBE_PAY_INDIVIDUAL_DEVELOPER_GUIDE.md](../VIBE_PAY_INDIVIDUAL_DEVELOPER_GUIDE.md)。
- **移动端与桌面端自适应**：
  - 手机扫码访问 (H5) 自动调用 `alipay.trade.wap.pay`（唤起支付宝 App 极速指纹/刷脸支付）。
  - 电脑 PC 访问自动使用 `alipay.trade.page.pay`（大屏扫码支付）。
- 采用 **RSA2 / SHA256withRSA**，签名与验签使用纯 `node:crypto` 实现，避免第三方 SDK 版本兼容问题。
- 回调务必校验：验签通过 + `app_id` 一致 + `trade_status=TRADE_SUCCESS` + `total_amount` 与订单金额一致，四关全过才发放。
- 幂等：`SETNX pay:lock:{order_no}` + `purchase_order` 状态机（只 pending→paid），支付宝重复回调不会重复加钱。
- 加余额只在验签通过的回调里发生，前端任何“我已支付”都不作数。

## 短信 / 号码认证

- 网页端个人开发者建议先用**短信验证码**兜底（`/api/auth/sms/send`），稳定不依赖机型网络。
- 一键登录（`/api/auth/oneclick`）已留接口位：前端接阿里云号码认证 SDK，拿到 token 传后端，后端调 `GetMobile` 换真实手机号后复用同一套登录逻辑。H5 一键登录体验不稳，App 端才适合，本项目暂不做 App。
- 开发调试时把 `SMS_DEBUG_RETURN_CODE=true`，验证码随 `/sms/send` 响应返回，方便联调；上线务必关掉。

## 本地快速验证（不走 Docker）

```bash
cd backend
cp .env.example .env      # DB/Redis 指向本地或云端，先填好
npm install
node --check src/server.js # 语法自检
npm start                 # 监听 9100，curl http://127.0.0.1:9100/healthz 应返回 ok
```
