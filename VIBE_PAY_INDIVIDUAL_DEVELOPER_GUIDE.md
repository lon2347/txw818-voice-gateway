# 支付宝 AI 付 (Vibe Pay) 个人开发者接入指引

本文档专门面向**个人开发者**（无企业营业执照主体），指导如何通过支付宝官方推出的 **AI 付 / Vibe Pay** 商业化收款方案，完成个人签约入驻、密钥生成、配置联调与自动履约发放。

---

## 一、什么是 Vibe Pay (支付宝 AI 付)？

传统支付宝当面付或电脑网站支付需要企业法人营业执照或个体工商户资质，个人开发者难以合规接入。
为此，支付宝官方推出了面向 AI / Vibe Coding 个人开发者的专属变现产品：**支付宝 AI 付 (Vibe Pay)**。

- **官方官网**：[https://aipay.alipay.com/](https://aipay.alipay.com/)
- **主体资质**：**支持个人支付宝账号**（仅需个人身份证完成实名认证，**无需营业执照**）。
- **收款模式**：支持单次买断、时长加油包、Token 包等计费模式。
- **底层架构**：基于标准支付宝开放平台网关 (`https://openapi.alipay.com/gateway.do`)，采用 **RSA2 (SHA256withRSA)** 数字签名，安全合规，资金直接结算至个人绑定的支付宝账户。

---

## 二、个人开发者开通三步走

### 第一步：登录并开通 AI 付
1. 打开 [支付宝 AI 付官网 (aipay.alipay.com)](https://aipay.alipay.com/)。
2. 使用手机支付宝扫码登录您的**个人支付宝账号**。
3. 进入开发者控制台，选择开通 **基础收款能力**（或 Vibe Pay 收款服务）。
4. 按照系统指引完成个人开发者实名认证（签署个人开发者协议）。

### 第二步：创建应用并获取 AppID
1. 在控制台中创建您的应用（例如：`TXW818 智能语音伴侣`）。
2. 创建成功后，控制台将为您分配一个专属的 **应用 AppID**（通常为 16 位以 2021 开头的数字）。

### 第三步：生成与配置 RSA2 密钥
在接口调用时，采用非对称加密算法 `RSA2`：
- **应用私钥 (Private Key)**：由您本地生成并保管，**仅配置在后端环境变量中，绝不下发**。用于给下单请求签名。
- **应用公钥 (Public Key)**：由您本地生成，上传至支付宝开放平台控制台。
- **支付宝公钥 (Alipay Public Key)**：上传应用公钥后，**由支付宝控制台生成并提供给您**。后端用于校验支付宝回调通知的真实性。

#### 密钥生成方法（二选一）：
* **方法 A（推荐）：使用支付宝官方密钥生成工具**
  1. 下载官方“支付宝开放平台开发助手”。
  2. 选择密钥格式：**PKCS8（JAVA适用）**，密钥长度：**2048 位**。
  3. 点击“生成密钥”，得到应用私钥和应用公钥。
  4. 将生成的“应用公钥”复制粘贴到 AI 付控制台的应用设置中。
  5. 复制控制台生成的 **支付宝公钥**（注意：不是自己的应用公钥）。

* **方法 B：使用 OpenSSL 命令行生成**
  ```bash
  # 生成 PKCS8 私钥
  openssl genpkey -algorithm RSA -out app_private_key.pem -pkeyopt rsa_keygen_bits:2048
  # 提取应用公钥
  openssl rsa -pubout -in app_private_key.pem -out app_public_key.pem
  ```

---

## 三、项目代码对 Vibe Pay 的原生支持

本项目后端及前端代码已对 Vibe Pay 做了 100% 深度适配，且特别强化了移动端扫码体验：

### 1. 移动端与桌面端自适应拉起 (`backend/src/routes/order.js`)
* **手机扫码访问 (H5)**：后端自动识别 User-Agent，调用 `alipay.trade.wap.pay`（产品码 `QUICK_WAP_WAY`），用户点击购买后可**直接拉起手机支付宝 App 收银台**完成指纹/刷脸支付。
* **桌面端访问 (PC)**：自动降级为 `alipay.trade.page.pay`（产品码 `FAST_INSTANT_TRADE_PAY`），展示支付宝大屏扫码页。

### 2. 纯 Node 原生安全验签 (`backend/src/lib.js`)
* 采用 Node.js 原生 `crypto` 模块实现 `SHA256withRSA`，不绑定第三方冗余 SDK，杜绝依赖版本漏洞。
* 自动格式化单行 PEM 私钥/公钥，避免因换行符导致的验签失败。

### 3. 严格的回调防重与履约 (`backend/src/routes/pay.js`)
* **地址**：`POST https://api.yourdomain.com/pay/alipay/notify`
* **四重校验**：支付宝公钥 RSA2 验签 ➔ `app_id` 比对 ➔ 交易状态 `TRADE_SUCCESS` ➔ 订单金额比对。
* **分布式幂等锁**：`SETNX pay:lock:{order_no}`（有效防并发重复发放）。
* **原子履约**：MySQL 记录流水，Redis 实时写入 `voice:balance:user:{uid}`，TXW818 硬件秒级感知可用时长。

---

## 四、环境变量配置清单 (`backend/.env`)

在 `implement plan/backend/.env`（以及生产部署环境）中填入获取到的参数即可：

```ini
# ==============================================================================
# Vibe Pay / 支付宝个人开发者配置
# ==============================================================================
# 支付宝标准网关（Vibe Pay 底层共用该网关）
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do

# 您的个人开发者应用 AppID
ALIPAY_APP_ID=202100xxxxxxxxxx

# 您的应用私钥 (PKCS8 格式，单行或多行均可，首尾带不带 -----BEGIN... 均可)
ALIPAY_PRIVATE_KEY=MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...

# 支付宝控制台生成的【支付宝公钥】(注意：千万不要填成自己的应用公钥！)
ALIPAY_PUBLIC_KEY=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...

# 异步通知回调地址 (必须为外网可访问的 HTTPS/HTTP 地址，且不要配置反代重定向)
ALIPAY_NOTIFY_URL=https://api.yourdomain.com/pay/alipay/notify

# 前端回跳地址 (用户付款完毕后自动返回的 Angular 页面)
ALIPAY_RETURN_URL=https://api.yourdomain.com/pay/result
```

---

## 五、本地调试与联调建议

1. **内网穿透（本地调试异步回调）**：
   支付宝异步回调通知由支付宝服务器直接 POST 触发，本地开发时需让外网能够访问到您的 9100 端口。推荐使用 `cpolar`、`ngrok` 或拥有公网 IP 的 CVM 进行反代：
   ```bash
   # 例如使用 cpolar 将本地 80 端口映射到公网
   cpolar http 80
   # 将获取到的公网域名配置到 ALIPAY_NOTIFY_URL: https://xxxx.cpolar.top/pay/alipay/notify
   ```

2. **沙箱模式（可选）**：
   如果应用还在审核期，可登录支付宝开放平台控制台使用“沙箱环境”提供的 Sandbox AppID 与沙箱买家账号进行全流程测试，此时将 `ALIPAY_GATEWAY` 修改为：
   `https://openapi-sandbox.dl.alipaydev.com/gateway.do`

---
*指南已就绪。系统已完全匹配个人开发者 Vibe Pay 标准规范。*

