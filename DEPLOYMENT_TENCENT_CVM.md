# Deploying TXW818 Voice Gateway to a Tencent Cloud CVM

> Target: the whole stack in this repository (nginx + frontend + backend + gateway + MySQL + Redis)
> running on a **single Tencent Cloud CVM** (Cloud Virtual Machine) with Docker Compose.
>
> Note: "VCM" in the request is read as **CVM**. If you actually want TKE / Serverless / Lighthouse
> instead, see [Section 14](#14-alternative-topologies) — the same images apply.

Everything below is derived from the actual files in this repo:
[docker-compose.yml](docker-compose.yml), [deploy.sh](deploy.sh),
[nginx/conf.d/common_proxy.inc](nginx/conf.d/common_proxy.inc),
[backend/.env.example](backend/.env.example), and the three Dockerfiles.

---

## 1. What gets deployed

```
Internet / TXW818 device
        │  https://api.yourdomain.com:443   ·   wss://api.yourdomain.com/v1/voice/stream
        ▼
   vg-nginx (nginx:alpine) ── ports 80, 443 (the ONLY published ports)
        ├── /                  → vg-frontend (Angular static + SPA fallback, :80)
        ├── /api/              → vg-backend  (Express API, :9100)
        ├── = /pay/alipay/notify → vg-backend (Alipay async callback, :9100)
        └── /v1/voice/         → vg-gateway  (WebSocket, :8080, Upgrade passthrough)
 vg-backend ──┬── vg-mysql (MySQL 8.0, voice_gateway)     ← authoritative data
              └── vg-redis (Redis 7, AOF)                 ← real-time balance of record
 vg-gateway ────── vg-redis                               ← reads/decrements balance per second
```

| Compose service | Image / build | Container | Internal port | Published | Health |
|---|---|---|---|---|---|
| `mysql` | `mysql:8.0` | `vg-mysql` | 3306 | no | `mysqladmin ping` |
| `redis` | `redis:7-alpine` | `vg-redis` | 6379 | no | `redis-cli ping` |
| `backend` | `backend/Dockerfile` → `voice-backend:latest` | `vg-backend` | 9100 | no | `GET /healthz` → `ok` |
| `gateway` | `gateway/Dockerfile` → `voice-gateway:latest` | `vg-gateway` | 8080 | no | `GET /healthz` → `gateway ok` |
| `frontend` | `frontend/Dockerfile` → `voice-frontend:latest` | `vg-frontend` | 80 | no | SPA served |
| `nginx` | `nginx:alpine` | `vg-nginx` | 80/443 | **yes** | TLS terminator |

All containers share the `voice-net` bridge network; nothing except nginx is reachable from the
outside. Memory caps are set per service (MySQL 768M, backend/gateway 384M, frontend 256M,
nginx 192M ≈ 2.1 GB, which is why a 2C4G instance is the practical minimum).

---

## 2. Prerequisites checklist

| Item | Value / requirement | Notes |
|---|---|---|
| CVM region | **Guangzhou** (or Shanghai/Beijing, closest to devices) | Lower latency for voice streams; Tencent speech APIs are also mainland-hosted |
| CVM spec | 2 vCPU / 4 GB, 50 GB SSD, Ubuntu 22.04 LTS | Upgrade to 4C8G if you add RVC/GPU inference or >10 concurrent devices |
| Public IP | Yes (or EIP) | Required for SSH, HTTPS, WSS and Alipay callbacks |
| Security group | TCP **22** (source-restricted), **80**, **443** only | Never open 3306 / 6379 / 9100 / 8080 |
| Domain | e.g. `api.yourdomain.com`, **A record → CVM public IP** | The repo docs and `.env.example` all use this name |
| **ICP filing (备案)** | Mandatory for a mainland CVM serving HTTP/HTTPS on 80/443 | Without it Tencent blocks the port and Alipay callbacks will never arrive |
| TLS certificate | CA-issued (Tencent Cloud free DV cert, or Let's Encrypt) | Self-signed works for the web UI smoke test, but TXW818 firmware and Alipay will reject it |
| Alipay / Vibe Pay | `APP_ID` + app private key + Alipay public key | See [VIBE_PAY_INDIVIDUAL_DEVELOPER_GUIDE.md](VIBE_PAY_INDIVIDUAL_DEVELOPER_GUIDE.md); the callback URL must be publicly reachable over HTTPS |
| Aliyun SMS | `SMS_PROVIDER` + `ALIYUN_ACCESS_KEY_ID/SECRET`, sign name, template code | **Both** channels are implemented in `backend/src/lib.js` (one RPC HMAC-SHA1 signer, pure `node:crypto`): `dypnsapi` = 号码认证服务·短信认证 (`SendSmsVerifyCode` / `CheckSmsVerifyCode`; Aliyun generates **and** validates the code, using the console's **gifted** 签名+模板 — no review needed, this is what an individual developer can use today), `dysmsapi` = 短信服务 (`SendSms`, needs an approved 签名/模板). Either fires only when all four `ALIYUN_*` values are set; until then the endpoint stays usable in debug mode — see Section 12 #3 |
| Tencent Cloud voice keys | `SecretId` / `SecretKey` | Only ever live inside the gateway process (see Section 16 gap #1) |
| Deploy directory | `/opt/voice-gateway` (used below) | Any path works; keep compose and code together |

---

## 3. Provision the CVM

Console path: **Cloud Console → CVM → Instances → New**. Recommended choices (matching
[语音网关部署计划.md](语音网关部署计划.md)):

- Billing: **pay-as-you-go** while debugging; pick **No-charge shutdown** when pausing (the system
  disk still bills a small amount); **Destroy** the instance to stop all billing.
- Image: Ubuntu 22.04 (login user is `ubuntu`).
- Bandwidth: billed by traffic, cap 10 Mbps during debug.
- Login: key pair preferred; if you set a password, change it to key-only access in Section 4.
- Tick the free **Security Hardening / Cloud Monitor / Automated Assistant** add-ons.
- After creation, install updates and set the timezone (billing timestamps and Alipay signatures
  are timezone-sensitive):

```bash
ssh ubuntu@<CVM_PUBLIC_IP>
sudo apt update && sudo apt -y upgrade
sudo timedatectl set-timezone Asia/Shanghai
```

---

## 4. Lock down SSH

```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

Keep the security group rule for TCP 22 restricted to your office/home IP.

---

## 5. Install Docker Engine + Compose v2

Use the Aliyun docker-ce mirror (the Tencent mirror lacks the compose plugin) and the
Tencent Cloud internal registry accelerator, which only resolves from inside Tencent's network:

```bash
sudo apt install -y ca-certificates curl gnupg lsb-release openssl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(lsb_release -cs) stable" | \
sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker compose version          # v2 is required — deploy.sh checks for it

# Registry accelerator (Tencent internal mirror — works only from a CVM)
sudo mkdir -p /etc/docker
echo '{"registry-mirrors":["https://mirror.ccs.tencentyun.com"],"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"5"}}' | \
  sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
sudo usermod -aG docker $USER   # log out and back in to take effect
```

The `log-driver` block also caps container log size, so a long-running box never fills its disk
with JSON logs.

Optional but recommended on a 4 GB box (MySQL + Angular build can spike):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 6. Upload the project

**Option A — private Git repository (preferred):**

```bash
sudo mkdir -p /opt/voice-gateway && sudo chown -R ubuntu:ubuntu /opt/voice-gateway
git clone <your-repo-url> /opt/voice-gateway
cd /opt/voice-gateway
```

**Option B — direct upload from this Windows workstation** (avoids shipping `node_modules`,
`.angular`, `.git`):

```powershell
cd d:\xianyu\AISOUND\txw818-voice-gateway
tar --exclude=node_modules --exclude=.angular --exclude=.git --exclude=dist -czf $env:TEMP\voice-gateway.tgz .
scp $env:TEMP\voice-gateway.tgz ubuntu@<CVM_PUBLIC_IP>:/home/ubuntu/
ssh ubuntu@<CVM_PUBLIC_IP> "sudo mkdir -p /opt/voice-gateway && sudo chown -R ubuntu:ubuntu /opt/voice-gateway && tar -xzf /home/ubuntu/voice-gateway.tgz -C /opt/voice-gateway"
```

The layout on the server must keep the relative paths the compose file expects:
`backend/Dockerfile`, `backend/db/*.sql`, `backend/.env`, `gateway/`, `frontend/`,
`nginx/nginx.conf`, `nginx/conf.d/`, `nginx/certs/`.

> Do not upload `backend/node_modules` or `frontend/node_modules`: `.dockerignore` excludes them
> and the images install their own dependencies.

---

## 7. Configure secrets (`backend/.env`)

```bash
cd /opt/voice-gateway
cp backend/.env.example backend/.env
openssl rand -hex 32      # use the output as JWT_SECRET
nano backend/.env
```

| Variable | Production value | Why it matters |
|---|---|---|
| `PORT` | keep `9100` | internal only, nginx proxies it |
| `JWT_SECRET` | **new ≥32-char random value** | Signs the user login token (7-day expiry); a leaked/default secret = account takeover |
| `SMS_DEBUG_RETURN_CODE` | **`false`** (only `true` while debugging) | `true` returns the SMS code in the `/api/auth/sms/send` response — anyone can log in as any phone number |
| `SMS_PROVIDER` | `dypnsapi` or `dysmsapi` | Picks the Aliyun product: `dypnsapi` = 号码认证服务·短信认证 (gifted sign/template, Aliyun owns the code), `dysmsapi` = 短信服务 (approved sign/template, we own the code). Empty or a typo = **no SMS is sent at all** (`smsMode()` → `off`) |
| `DB_*` / `REDIS_*` | leave as-is | **The compose `environment:` block overrides these** (Section 7.1) |
| `ALIYUN_ACCESS_KEY_ID/SECRET`, `ALIYUN_SMS_SIGN_NAME`, `ALIYUN_SMS_TEMPLATE_CODE` | your Aliyun SMS credentials | A real send happens only when **all four** are non-empty (`smsMode()` != `off`); `ALIYUN_SMS_ENDPOINT` is derived from `SMS_PROVIDER` when left empty. For `dysmsapi` the template's variable **must** be named `code` (the backend passes `{ code }`); for `dypnsapi` the placeholder must be the literal `##code##` and `ALIYUN_SMS_TEMPLATE_CODE` is a numeric gifted-template id |
| `ALIYUN_SMS_SCHEME_NAME`, `ALIYUN_SMS_TEMPLATE_PARAM_JSON`, `ALIYUN_SMS_CODE_LENGTH` / `_VALID_TIME` / `_INTERVAL` / `_CODE_TYPE` | `dypnsapi` only | Leave `SCHEME_NAME` empty to use the default 认证方案, but the **same** value must be used for send and check. `TEMPLATE_PARAM_JSON` must match the gifted template's variables exactly (default `{"code":"##code##","min":"5"}`); extra/missing keys are rejected. `VALID_TIME`/`INTERVAL` are what Aliyun enforces — keep `INTERVAL` equal to the frontend's 60 s countdown |
| `ALIPAY_APP_ID`, `ALIPAY_PRIVATE_KEY`, `ALIPAY_PUBLIC_KEY` | from the Alipay open platform | Keys are normalized by `lib.js` with or without PEM headers, so a bare base64 key is fine |
| `ALIPAY_NOTIFY_URL` | `https://api.yourdomain.com/pay/alipay/notify` | Must exactly match the `location = /pay/alipay/notify` rule in `common_proxy.inc` |
| `ALIPAY_RETURN_URL` | `https://api.yourdomain.com/pay/result` | This is an **Angular SPA route** (`app.routes.ts` → `PayResultComponent`), served by `location /`, not a backend endpoint |

`.env` is git-ignored and excluded by `backend/.dockerignore`, so it never bakes into an image —
it is injected via `env_file` at container start.

### 7.1 Passwords live in `docker-compose.yml`, not in `.env`

[docker-compose.yml](docker-compose.yml) hard-codes the DB credentials in the `mysql` service,
in its `healthcheck`, and in the `backend` service `environment:` block, which **takes precedence
over `env_file`**. So `voice_pass_change_me` / `root_voice_pass_change_me` must be changed in
**three places** in that file before going live:

1. `mysql.environment.MYSQL_ROOT_PASSWORD`
2. `mysql.environment.MYSQL_PASSWORD` **and** `mysql.healthcheck.test` (they must stay in sync)
3. `backend.environment.DB_PASSWORD`

The data directory is initialized on first boot only — if you change the password **after** the
`mysql_data` volume exists, also update the live grants:

```bash
docker compose exec mysql mysql -uroot -p'<OLD_ROOT_PW>' -e \
 "ALTER USER 'voice'@'%' IDENTIFIED BY '<NEW_PW>'; FLUSH PRIVILEGES;"
```

Redis currently has no password (compose does not pass `REDIS_PASSWORD` to `gateway` either).
That is acceptable because Redis is only on `voice-net`, but if you enable `requirepass`, add
`REDIS_PASSWORD` to **both** the `backend` and `gateway` `environment:` blocks.

---

## 8. TLS certificates

Compose mounts `./nginx/certs` read-only and [default.conf](nginx/conf.d/default.conf) expects
exactly two files:

```
nginx/certs/fullchain.pem   # server cert + intermediates, concatenated
nginx/certs/privkey.pem     # private key
```

**Option A — Tencent Cloud free/issued certificate (recommended):**
download the **Nginx** bundle from the SSL Certificates console and unzip it into `nginx/certs`,
renaming `1_api.yourdomain.com_bundle.pem → fullchain.pem` and
`2_api.yourdomain.com.key → privkey.pem`. Set `chmod 600 nginx/certs/privkey.pem`.

**Option B — Let's Encrypt with webroot** (no container stop needed; renewals are automated):

```bash
sudo apt install -y certbot
sudo mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot -d api.yourdomain.com \
  --deploy-hook "cp /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem /opt/voice-gateway/nginx/certs/ && \
                  cp /etc/letsencrypt/live/api.yourdomain.com/privkey.pem /opt/voice-gateway/nginx/certs/ && \
                  docker compose -f /opt/voice-gateway/docker-compose.yml exec nginx nginx -s reload"
sudo crontab -l 2>/dev/null | { cat; echo '0 3 * * * certbot renew --quiet'; } | sudo crontab -
```

To make option B work, add one line inside the port-80 `server` block of
`nginx/conf.d/default.conf` (before the `include`):
`location /.well-known/acme-challenge/ { root /var/www/certbot; }` and mount
`- /var/www/certbot:/var/www/certbot:ro` into the `nginx` service.

**Option C — self-signed, debug only.** `deploy.sh` auto-generates one if `nginx/certs` is empty,
so the stack boots without a real cert. Expect browser warnings **and failed device WSS
handshakes**, and do not test Alipay callbacks on it.

Once you have a real cert, enable the HTTP→HTTPS redirect by uncommenting
`return 301 https://$host$request_uri;` in `default.conf`. Keep the
`location = /pay/alipay/notify` reachable if your `notify_url` is still declared as `http://`.

---

## 9. Build images

`docker compose up -d --build` builds all three custom images. Two things to know up front:

- **npm dependency download is the slow/risky part** (`npm ci` inside
  `frontend/Dockerfile` pulls the whole Angular toolchain; on a mainland box this can time out).
  If the build stalls, add the Tencent npm mirror to the builder stages — one line each:

  ```dockerfile
  # frontend/Dockerfile (builder stage) and backend/gateway Dockerfiles, after WORKDIR /app
  RUN npm config set registry https://mirrors.cloud.tencent.com/npm/
  ```

  Then rebuild: `docker compose build --no-cache frontend backend gateway`.
- The frontend build is memory-hungry. If it is killed (`exit code 137`), enable the swap from
  Section 5 or build the frontend stage on your workstation and only ship the image.

```bash
cd /opt/voice-gateway
docker compose build backend gateway frontend
docker compose pull mysql redis nginx
```

---

## 10. First launch

Either use the repo script (it auto-copies `.env`, generates a dev cert if missing, then builds
and starts, and prints the URLs):

```bash
./deploy.sh up
```

…or drive compose directly for more control:

```bash
cd /opt/voice-gateway
docker compose up -d
docker compose ps          # every service should be Up / (healthy)
docker compose logs -f --tail=100 mysql redis backend gateway nginx
```

Expected log lines:

| Service | Healthy startup signal |
|---|---|
| mysql | `ready for connections` (first boot also runs `01_base_schema.sql`, `02_backend_schema.sql`) |
| redis | `Ready to accept connections`, then `Background append only file rewriting started` |
| backend | `voice-backend listening on 9100` |
| gateway | `TXW818 Voice Gateway listening on port 8080` |
| frontend | `start worker process` |
| nginx | `start worker process` + no `SSL_load_private_key` error |

Because every service is `restart: unless-stopped` and docker is `systemctl enable`d, the stack
comes back on its own after a reboot. Verify with `docker compose ps` after
`sudo reboot`.

---

## 11. Database schema and seed data

`./backend/db` is mounted as `/docker-entrypoint-initdb.d`, so both scripts run **automatically —
but only when the `mysql_data` volume is empty**:

- `01_base_schema.sql` — creates `voice_gateway`, `device`, `pkg`, `purchase_order`,
  `voice_session`; seeds three sale packages (60 min/¥9.90, 300 min/¥39.90, 1000 min/¥99.00) and
  two test devices `TXW818-ABC123`, `TXW818-DEMO01`.
- `02_backend_schema.sql` — adds `user`, `sms_code`, `wallet_user`, `pay_notify_log` and `ALTER`s
  `device.user_id`, `purchase_order.user_id/minutes/amount/subject/alipay_trade_no`.

Consequences to be aware of:

1. **Editing the SQL files does nothing on an existing deployment.** To re-init from scratch
   (destroys all data — back up first): `docker compose down && docker compose down -v && docker compose up -d`.
2. To apply migrations to an **existing** database, run them manually; `ADD COLUMN` on a column
   that already exists throws `Duplicate column name`, which is safe to skip:
   ```bash
   docker compose exec -T mysql mysql -uvoice -p'<DB_PASSWORD>' voice_gateway \
     < backend/db/02_backend_schema.sql
   ```
3. Sanity check the result:
   ```bash
   docker compose exec mysql mysql -uvoice -p'<DB_PASSWORD>' voice_gateway \
     -e "SHOW TABLES; SELECT id,name,minutes,price,on_sale FROM pkg; SELECT device_id,status FROM device;"
   ```

---

## 12. Verification (do this before pointing devices at it)

**1) Ports and TLS**

```bash
ss -lntp | grep -E ':(80|443)'                       # only nginx
curl -I http://api.yourdomain.com                     # 200 (or 301 once HTTPS redirect is on)
echo | openssl s_client -connect api.yourdomain.com:443 -servername api.yourdomain.com 2>/dev/null | openssl x509 -noout -dates -subject
```

**2) Route-by-route, through nginx**

```bash
curl -s https://api.yourdomain.com/ | head -5                        # Angular index.html
curl -s https://api.yourdomain.com/api/orders/packages               # {"code":0,"msg":"ok","data":[...3 packages...]}
curl -s -X POST https://api.yourdomain.com/api/devices/resolve \
     -H 'Content-Type: application/json' -d '{"device_id":"TXW818-ABC123"}'
curl -s https://api.yourdomain.com/healthz                           # see note below
```

`/healthz` is **not** proxied by `common_proxy.inc`, so the request falls through to the frontend
container and returns `index.html` with status 200 — a monitoring check on it would pass even if
the backend were down (`deploy.sh` advertises it as the health URL). For a real probe, add to
`nginx/conf.d/common_proxy.inc`:

```nginx
location = /healthz {
    proxy_pass http://backend:9100/healthz;
    access_log off;
}
```

then `docker compose exec nginx nginx -s reload` and confirm it returns `ok`.

**3) Login → bind → wallet → balance plumbing** (use a test phone number)

Which mode `/api/auth/sms/send` runs in depends on `SMS_PROVIDER` — this is the quickest way to
confirm the SMS leg. `smsMode()` returns `off` unless **all four** `ALIYUN_*` values are non-empty,
so a half-filled config degrades to the debug echo instead of failing mid-send:

| `SMS_PROVIDER` | `ALIYUN_*` complete? | `SMS_DEBUG_RETURN_CODE` | Behavior |
|---|---|---|---|
| empty / typo | any | `true` | No SMS sent; our own 6-digit code goes into `sms_code`; response carries `data.debugCode`, `smsGatewayConfigured:false`, `sent:false` — log in with that code |
| empty / typo | any | `false` | `code:5012` "短信通道未配置" (fail-fast instead of a silently undeliverable code) |
| `dypnsapi` | yes | `false` | Real `SendSmsVerifyCode` — **Aliyun generates the code**, `sms_code` stays empty; `msg:"验证码已发送"`, `data:{}`. Rejection → `code:5011` + the provider `Code` (`FREQUENCY_FAIL` / `BUSINESS_LIMIT_CONTROL` are mapped to `4290`) and the cooldown lock is released so the user can retry |
| `dypnsapi` | yes | `true` | Same send plus `ReturnVerifyCode=true`, which echoes Aliyun's code as `data.debugCode` — debug only, never ship this combination |
| `dysmsapi` | yes | `false` | Real Aliyun `SendSms`; `msg:"验证码已发送"`; Aliyun rejection → `code:5011` + the provider `Code` (e.g. `isv.SMS_SIGNATURE_ILLEGAL`), and the code row is rolled back |

The verify leg follows the same switch: on `dypnsapi`, `/sms/verify` calls `CheckSmsVerifyCode`
and logs in **only** when `Model.VerifyResult === "PASS"` (`Code=OK` alone means the API call
worked, not that the code matched); a transport/auth failure returns `code:5013` rather than a
misleading "wrong code" `4002`.

A second request for the same number within the cooldown window returns `code:4290`. On `dysmsapi`
and on the unconfigured path this is enforced in MySQL via `sms_code.created_at`; on `dypnsapi`,
which never writes that table, it is a Redis lock `sms:cooldown:{phone}` held for
`ALIYUN_SMS_INTERVAL` seconds — so `SELECT * FROM sms_code` legitimately staying empty is normal on
that channel. Either way this is what protects the paid SMS channel from being farmed.

```bash
# With SMS_DEBUG_RETURN_CODE=true you can read the code straight from the response:
curl -s -X POST https://api.yourdomain.com/api/auth/sms/send -H 'Content-Type: application/json' \
     -d '{"phone":"13800000000","scene":"login"}'
curl -s -X POST https://api.yourdomain.com/api/auth/sms/send -H 'Content-Type: application/json' \
     -d '{"phone":"13800000000","scene":"login"}'      # expect 4290 (cooldown)  
curl -s -X POST https://api.yourdomain.com/api/auth/sms/verify -H 'Content-Type: application/json' \
     -d '{"phone":"13800000000","scene":"login","code":"<debugCode>"}'   # → token
TOKEN=<paste>
curl -s -X POST https://api.yourdomain.com/api/devices/bind -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"device_id":"TXW818-ABC123"}'
curl -s https://api.yourdomain.com/api/wallet -H "Authorization: Bearer $TOKEN"
docker compose exec redis redis-cli keys 'voice:balance:user:*'
```

Note the Redis key of record is `voice:balance:user:{uid}` (`lib.js` `balanceKey()` and
`gateway/src/server.js` agree). The older `前端-后端-网关-支付对接文档.md` still documents
`wallet:user:{uid}` — trust the code. That key is **absent right after login**: it is written by
`syncBalanceToRedis`, which runs when a paid order is granted (Section 12 #6) or via the re-sync
in Section 13. `/api/wallet` reading `0` with no key present is therefore normal.

**4) WebSocket path through nginx**

```bash
curl -s --max-time 5 -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://api.yourdomain.com/v1/voice/stream
# 101 = upgrade reached the gateway; curl then hits --max-time and exits, which is expected
```

`101` means the `Upgrade` passthrough works. A `400`/`404` means the request never reached
`gateway` — check that the WSS path starts with `/v1/voice/` (`default.conf` proxies that prefix
only). To read frames, use a real client (`websocat 'wss://api.yourdomain.com/v1/voice/stream?user_id=1'`).

**5) Real device / manual WSS client**

The gateway currently identifies the session from query parameters (no token check yet):

```
wss://api.yourdomain.com/v1/voice/stream?device_id=TXW818-ABC123&user_id=1
```

With `voice:balance:user:1` at `0` you should immediately receive
`{"type":"error","code":402,"msg":"账户语音时长不足，请充值加油包"}` and close code `4402` —
that is the expected rejection. Seed a balance and you should see `{"type":"ready",...}` followed
by 1 credit decremented per second:

```bash
docker compose exec redis redis-cli set voice:balance:user:1 300
docker compose exec redis redis-cli get voice:balance:user:1     # watch it tick down
```

**6) Alipay**
Buy a package from `/recharge` on a phone and on a desktop. On mobile the backend picks
`alipay.trade.wap.pay`, on desktop `alipay.trade.page.pay`. Then confirm:

```bash
docker compose logs backend | grep -E '\[pay\]'      # no 验签失败 / 金额不符
docker compose exec mysql mysql -uvoice -p'<DB_PASSWORD>' voice_gateway \
  -e "SELECT order_no,status,amount,paid_at FROM purchase_order ORDER BY id DESC LIMIT 5;"
docker compose exec mysql mysql -uvoice -p'<DB_PASSWORD>' voice_gateway \
  -e "SELECT order_no,LEFT(raw,120) FROM pay_notify_log ORDER BY id DESC LIMIT 5;"
```

If no callback ever arrives: the domain must be ICP-filed, HTTPS must be CA-issued, and
`notify_url` must be exactly `https://api.yourdomain.com/pay/alipay/notify`.
Duplicate callbacks must not double-credit — `SETNX pay:lock:{order_no}` plus the
`status='pending' → 'paid'` transition guard in `grantPaidOrder` (`backend/src/lib.js`).

---

## 13. Day-2 operations

**Release a new version** (zero-downtime enough for this scale):

```bash
cd /opt/voice-gateway
git pull                                   # or re-upload the tarball
docker compose build backend gateway frontend
docker compose up -d                        # only changed containers are recreated
docker images | grep voice-                 # confirm new image IDs/timestamps
```

Rollback: rebuild/retag the previous commit, or `docker compose up -d` after checking out the old
tag. Keep images (`voice-backend:latest` etc.) and tag them per release
(`docker tag voice-backend:latest voice-backend:2026-11-12`) if you want instant rollback.

**Backups** (the named volumes survive `docker compose down`, but not `-v`):

```bash
mkdir -p /opt/backup
# MySQL: nightly logical dump, 14-day retention
cat > /opt/backup/mysql-backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%F_%H%M)
docker compose -f /opt/voice-gateway/docker-compose.yml exec -T mysql \
  mysqldump -uvoice -p'<DB_PASSWORD>' --single-transaction --routines voice_gateway \
  | gzip > /opt/backup/voice_gateway_$TS.sql.gz
find /opt/backup -name 'voice_gateway_*.sql.gz' -mtime +14 -delete
EOF
chmod +x /opt/backup/mysql-backup.sh
( crontab -l 2>/dev/null; echo '15 3 * * * /opt/backup/mysql-backup.sh' ) | crontab -
```

Redis holds the **authoritative live balance**; MySQL holds the `wallet_user` snapshot. If Redis
is lost, balances are not automatically rebuilt from MySQL — re-sync per user through the
backend path (`syncBalanceToRedis`) or seed manually:

```bash
docker compose exec mysql mysql -N -B -uvoice -p'<DB_PASSWORD>' voice_gateway \
  -e "SELECT CONCAT('SET voice:balance:user:',user_id,' ',balance_sec) FROM wallet_user;" \
  > /tmp/resync.redis
docker compose exec -T redis redis-cli < /tmp/resync.redis
```

Copy `/opt/backup` off-instance (COS CLI / `scp`) — a destroyed CVM takes its disk with it.

**Monitoring.** Add Tencent Cloud Monitor agents/alarm policies on CPU, memory, disk and public
network out. Inside the box:

```bash
docker compose ps
docker stats --no-stream
docker compose logs --since 10m backend gateway | grep -iE 'error|warn'
df -h; free -m
```

**Log access.** nginx writes access logs to the container stdout (`docker compose logs nginx`),
with gzip already enabled at the edge and a 3600 s read/send timeout on the WSS location so long
voice sessions are not cut off.

**Useful one-offs**

```bash
./deploy.sh logs backend          # docker compose logs -f backend
./deploy.sh restart               # whole stack
./deploy.sh status                # docker compose ps
./deploy.sh down                  # stop, keep volumes
docker compose exec backend sh    # inspect a container
```

---

## 14. Alternative topologies

| Option | When to prefer | What changes |
|---|---|---|
| **Lightweight Application Server (Lighthouse)** | cheapest fixed-package box for a single-site pilot of a few devices | Same commands; use its firewall instead of a CVM security group; no internal `mirror.ccs.tencentyun.com` accelerator guarantee |
| **Managed TencentDB for MySQL + TencentDB for Redis** | production, where you want backups/HA instead of container volumes | Delete the `mysql`/`redis` services; set `DB_HOST`/`REDIS_HOST` to the instance intranet addresses in the compose `environment:` blocks (Section 7.1), and put both instances in the CVM's VPC/security group |
| **TKE / Serverless Kubernetes** | multi-instance, autoscaling WSS fleet | Split the compose into Deployments + a Service/CLB ingress; the WebSocket session and Redis balance model are already stateless-friendly, but you must move TLS termination to the CLB/ingress and keep the `Upgrade` headers |
| **TCR (Container Registry) + CI build** | repeatable releases, no building on the box | Build `voice-backend`/`voice-gateway`/`voice-frontend` in CI, push to Tencent Cloud Container Registry, and change `build:` to `image:` on the CVM |
| **CLB in front of 2+ CVMs** | many devices / high availability | nginx role moves behind CLB (mind the WSS idle timeout), MySQL/Redis move to managed instances |

---

## 15. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `failed to fetch ... docker.io` or `net/http: TLS handshake timeout` on `pull` | Docker Hub not reachable from mainland | Keep the `mirror.ccs.tencentyun.com` accelerator in `/etc/docker/daemon.json`; retry; or import images from TCR |
| `npm ci` hangs / `ECONNRESET` during `compose build` | npm registry reachable but flaky | Set the Tencent npm mirror inside the Dockerfiles (Section 9) and rebuild with `--no-cache` |
| Frontend build killed, exit code `137` | Not enough RAM for the Angular/esbuild step | Enable swap (Section 5), raise to 4 GB, or build the image elsewhere |
| `vg-backend` in restart loop, log shows `Access denied for user 'voice'` | You changed `MYSQL_PASSWORD` after the volume was initialized | `ALTER USER` inside MySQL (Section 7.1), or recreate with `docker compose down -v` |
| `vg-backend` exits with `env file ./backend/.env not found` | `backend/.env` missing on the server | `cp backend/.env.example backend/.env` (or run `./deploy.sh`, which does it) |
| nginx `Up` but 502 for `/api/` | Backend not listening yet / wrong service name | `docker compose ps`, `docker compose logs backend`; the `proxy_pass http://backend:9100` must resolve on `voice-net` |
| WSS connects then instantly closes, HTTP `400` | Request path doesn't start with `/v1/voice/`, so `gateway/src/server.js` destroys the socket | Use `wss://host/v1/voice/stream?...`; device firmware URL must match |
| Device rejects the certificate | Self-signed `nginx/certs` | Install a CA-issued cert (Section 8); do not ship firmware against Option C |
| Balance never increases after payment | Callback blocked: no ICP filing, self-signed HTTPS, wrong `notify_url`, or signature verify failed | `docker compose logs backend \| grep '\[pay\]'`; confirm `ALIPAY_PUBLIC_KEY` is the **Alipay public key** (not your app public key) and the certificate mode in the Alipay console matches |
| `402` / "语音时长不足" for a user who paid | Redis key out of sync with `wallet_user` | `redis-cli get voice:balance:user:<uid>`; re-sync via `syncBalanceToRedis` path or Section 13 |
| Login codes visible in API responses | `SMS_DEBUG_RETURN_CODE=true` left on | Set to `false` in `backend/.env`, then `docker compose up -d backend` |
| `{"code":5012,"msg":"短信通道未配置"}` | `SMS_PROVIDER` left empty / misspelled, or an `ALIYUN_*` value blank, while debug echo is off | Set `SMS_PROVIDER=dypnsapi` (or `dysmsapi`) and fill all four `ALIYUN_*` values, or temporarily set `SMS_DEBUG_RETURN_CODE=true` for testing |
| `{"code":5011,"msg":"短信发送失败：isv.SMS_SIGNATURE_ILLEGAL"}` (dysmsapi) | `ALIYUN_SMS_SIGN_NAME` is not the approved signature text, or the template doesn't belong to it | Match the console's 签名/模板 exactly; template variable must be `${code}` |
| `isv.SMS_TEMPLATE_ILLEGAL` / `InvalidAccessKeyId` / `SignatureDoesNotMatch` (dysmsapi) | Template CODE is wrong or doesn't belong to that signature; wrong AccessKey pair; or the CVM clock drifted (the RPC `Timestamp` must be within 15 min of UTC) | Re-copy the values from the Aliyun console; `date -u`; check the RAM user still has `AliyunDysmsFullAccess` |
| `FUNCTION_NOT_OPENED` (dypnsapi) | The 短信认证 feature isn't switched on in the 号码认证 console | 控制台 → 号码认证服务 → 功能开启 → enable 短信认证, then retry |
| `MOBILE_NUMBER_ILLEGAL` / `INVALID_PARAMETERS` (dypnsapi) | Bad number, or `ALIYUN_SMS_TEMPLATE_PARAM_JSON` doesn't mirror the gifted template's variables (the code slot must stay the literal `##code##`) | The backend validates the 11-digit CN format before calling, so check the template param first; leave it empty to fall back to `{"code":"##code##","min":"5"}` |
| `Forbidden.NoPermission` / `You are not authorized to do this operation` (dypnsapi) | The RAM user has no 号码认证 permission — this is not a wrong AccessKey | Grant the system policy `AliyunDypnsFullAccess` in the RAM console (dysmsapi needs `AliyunDysmsFullAccess` instead) |
| `{"code":5013,"msg":"核验服务暂不可用…"}` (dypnsapi) | `CheckSmsVerifyCode` itself failed (AccessKey / policy / clock / network) — deliberately *not* reported as a wrong code | Read the trailing provider `Code` in `msg`, same fixes as the two rows above; `docker compose logs backend \| grep '\[sms\]'` |
| `{"code":4290,"msg":"验证码发送过于频繁…"}` | Working as designed: one code per number per `ALIYUN_SMS_INTERVAL` (default 60 s) — Redis lock on dypnsapi, `sms_code.created_at` elsewhere | Wait a minute; only investigate if it fires beyond 60 s. On dypnsapi you can clear it with `redis-cli del sms:cooldown:<phone>`; on the MySQL path it is a timezone skew (the box must be `Asia/Shanghai`) |
| `the attribute "version" is obsolete` warning | `version: '3.8'` in compose | Harmless; remove the line if it bothers you |
| `docker compose -f backend/docker-compose.override.yml ...` errors | `backend/docker-compose.override.yml` is a leftover from the earlier standalone scaffold (it also assumes a `default` network, while the real file uses `voice-net`) | Ignore/delete it — the root compose already defines `backend` |

---

## 16. Gaps to close before this faces real customers

These are code-level, not deployment-level, but they change the security posture once public:

1. **Gateway does not authenticate devices.** `gateway/src/server.js` takes `user_id` straight from
   the query string and never validates a `device_token`/`Authorization` header, so anyone can
   burn another user's balance. Add token verification (backend-issued `device_token`, revocable)
   before shipping firmware at scale.
2. **No upstream forwarding yet.** The Tencent speech-to-speech call is a TODO comment in
   `ws.on('message')`, so audio is currently billed but not transformed. The Tencent
   `SecretId/SecretKey` must arrive here as env vars (never to devices), ideally via CAM/STS
   temporary credentials.
3. **~~SMS has no real rate limit and no real send.~~ Resolved:** `routes/auth.js` now drives either
   Aliyun channel — 号码认证服务 `SendSmsVerifyCode` + `CheckSmsVerifyCode` (`SMS_PROVIDER=dypnsapi`, usable
   today with the gifted 签名/模板) or 短信服务 `SendSms` (`SMS_PROVIDER=dysmsapi`, after 签名/模板 approval) —
   and enforces the per-number cooldown on both (see `sendSms` / `pnvsSendCode` / `pnvsCheckCode` in
   `backend/src/lib.js`). What is still missing is a **CAPTCHA/滑块 gate** before the send, so keep the
   endpoint behind real traffic controls until you add one.
4. **`/admin` does not exist in this compose.** The integration doc mentions an admin service on
   port 9000; device entry, package edits and reconciliation currently require direct MySQL.
5. **No compose-level healthcheck for backend/gateway**, and `/healthz` is not exposed through
   nginx (Section 12 #2) — add both if you want uptime monitoring to be meaningful.
6. **`deploy/resources.limits` caps the whole stack at ~2.1 GB** on a 4 GB box, which is fine for
   a handful of devices; each concurrent voice session is a long-lived socket, so measure before
   promising dozens of devices.

---

## 17. Go-live checklist

- [ ] CVM: Guangzhou, 2C4G+, Ubuntu 22.04, timezone `Asia/Shanghai`, updates installed
- [ ] Security group: only 22 (source-restricted) / 80 / 443; no 3306/6379/9100/8080 exposed
- [ ] SSH password auth disabled, key-only login
- [ ] Docker + Compose v2 installed, registry mirror and log caps in `daemon.json`, `docker` enabled at boot
- [ ] Code at `/opt/voice-gateway`; `node_modules` not uploaded
- [ ] `backend/.env` filled: fresh `JWT_SECRET`, `SMS_DEBUG_RETURN_CODE=false`, `SMS_PROVIDER` set + all four `ALIYUN_*` values, Alipay keys, real `notify_url`/`return_url`
- [ ] SMS side ready in the Aliyun console: for `dypnsapi`, 功能开启 → 短信认证 enabled and the RAM user holds `AliyunDypnsFullAccess`; for `dysmsapi`, 签名/模板 both 审核通过 and the RAM user holds `AliyunDysmsFullAccess`
- [ ] SMS verified on a real phone: correct code logs in, a wrong code returns `4002` (not `5013`), a second send inside 60 s returns `4290`
- [ ] DB passwords replaced in all three spots of `docker-compose.yml`
- [ ] Domain A record → CVM IP, **ICP filing complete**, CA-issued cert in `nginx/certs`, HTTPS redirect enabled
- [ ] `docker compose ps` all healthy; `/api/orders/packages` returns the 3 seeded packages
- [ ] Test device bound, wallet balance visible, `voice:balance:user:<uid>` present in Redis
- [ ] Real Alipay payment end-to-end (mobile WAP + desktop page) → `purchase_order.status='paid'`, balance credited exactly once on duplicate callbacks
- [ ] WSS from a physical TXW818 works over `wss://` (101 handshake, 402 on empty balance)
- [ ] MySQL nightly dump cron + off-box copy; `/opt/backup` restored at least once as a drill
- [ ] Cloud Monitor alarms for CPU/memory/disk/network
- [ ] Section 16 gaps #1–#3 addressed (or explicitly accepted as a closed pilot)

---

Generated from a review of the repository on 2026-11-12. Command output and file paths follow the
files as they exist today; if you change `docker-compose.yml` or `common_proxy.inc`, re-check
Sections 7.1, 8 and 12.
