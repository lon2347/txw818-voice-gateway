// 公共基础设施：配置、MySQL、Redis、JWT、统一响应、支付宝签名/验签、阿里云短信 RPC 签名
require('dotenv').config();
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');

const cfg = {
  port: parseInt(process.env.PORT || '9100', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev_only_secret_change_me',
  smsDebug: String(process.env.SMS_DEBUG_RETURN_CODE) === 'true',
  alipay: {
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    appId: process.env.ALIPAY_APP_ID || '',
    privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
    publicKey: process.env.ALIPAY_PUBLIC_KEY || '',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
    returnUrl: process.env.ALIPAY_RETURN_URL || '',
  },
  // 阿里云短信。两条通道、同一套 RPC 签名（见下方 smsMode）：
  //   SMS_PROVIDER=dypnsapi  号码认证服务·短信认证（验证码由阿里云生成+核验，个人开发者可用，用赠送签名+赠送模板）
  //   SMS_PROVIDER=dysmsapi  短信服务（验证码自己生成、自己存 sms_code、自己比对）
  //   留空                不发短信，仅 SMS_DEBUG_RETURN_CODE=true 时把验证码回传前端
  aliyun: {
    provider: (process.env.SMS_PROVIDER || '').trim().toLowerCase(),
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || '',
    // dypnsapi：赠送签名/赠送模板 CODE（如 100001）；dysmsapi：审核通过的签名/模板（如 SMS_123456789）
    signName: process.env.ALIYUN_SMS_SIGN_NAME || '',
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE || '',
    endpoint: process.env.ALIYUN_SMS_ENDPOINT || '',            // 留空按 provider 自动取域名
    region: process.env.ALIYUN_SMS_REGION || 'cn-hangzhou',
    schemeName: process.env.ALIYUN_SMS_SCHEME_NAME || '',       // 仅 dypnsapi：认证方案名称，留空为默认方案
    templateParam: process.env.ALIYUN_SMS_TEMPLATE_PARAM_JSON || '', // 仅 dypnsapi：模板占位符 JSON
    codeType: parseInt(process.env.ALIYUN_SMS_CODE_TYPE || '1', 10),      // 1=纯数字
    codeLength: parseInt(process.env.ALIYUN_SMS_CODE_LENGTH || '6', 10),
    validTime: parseInt(process.env.ALIYUN_SMS_VALID_TIME || '300', 10),
    interval: parseInt(process.env.ALIYUN_SMS_INTERVAL || '60', 10),
  },
};

function aliEndpoint() {
  const a = cfg.aliyun;
  if (a.endpoint) return a.endpoint;
  return a.provider === 'dypnsapi' ? 'dypnsapi.aliyuncs.com' : 'dysmsapi.aliyuncs.com';
}

// 当前生效的短信通道：'dypnsapi' | 'dysmsapi' | 'off'（'off' = 不真发短信）
function smsMode() {
  const a = cfg.aliyun;
  if (!(a.accessKeyId && a.accessKeySecret && a.signName && a.templateCode)) return 'off';
  return (a.provider === 'dypnsapi' || a.provider === 'dysmsapi') ? a.provider : 'off';
}

function smsConfigured() { return smsMode() !== 'off'; }

// ---------- MySQL ----------
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'voice',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'voice_gateway',
  waitForConnections: true,
  connectionLimit: 10,
});

// ---------- Redis ----------
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});
redis.on('error', (err) => {
  console.warn('[Redis error]', err.message);
});

// ---------- 统一响应 ----------
function ok(res, data = {}, msg = 'ok') { res.json({ code: 0, msg, data }); }
function fail(res, code, msg) { res.status(200).json({ code, msg }); }

// ---------- JWT ----------
function signToken(user) {
  return jwt.sign({ uid: user.id, phone: user.phone }, cfg.jwtSecret, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return fail(res, 401, '未登录');
  try { req.user = jwt.verify(token, cfg.jwtSecret); next(); }
  catch (e) { return fail(res, 401, '登录态无效或已过期'); }
}

// ---------- 余额：Redis 为权威值，MySQL 落快照 ----------
// 键：voice:balance:user:{uid}  -> 剩余可用秒数（Int），网关按此键扣费
function balanceKey(uid) { return 'voice:balance:user:' + uid; }

// 支付成功后发放时长（必须在已开启事务的 conn 上调用）
async function grantPaidOrder(conn, order) {
  const seconds = order.minutes * 60;
  const [r] = await conn.execute(
    'UPDATE purchase_order SET status=?, paid_at=NOW(), alipay_trade_no=? WHERE order_no=? AND status=?',
    ['paid', order.tradeNo || null, order.orderNo, 'pending']
  );
  if (r.affectedRows !== 1) return 0; // 已被处理过，幂等
  await conn.execute(
    'INSERT INTO wallet_user (user_id, balance_sec) VALUES (?, ?) ' +
    'ON DUPLICATE KEY UPDATE balance_sec = balance_sec + VALUES(balance_sec)',
    [order.userId, seconds]
  );
  return seconds;
}

// 把 MySQL 权威余额同步进 Redis（供网关读取）
async function syncBalanceToRedis(uid) {
  const [rows] = await pool.execute('SELECT balance_sec FROM wallet_user WHERE user_id=?', [uid]);
  const sec = rows.length ? Number(rows[0].balance_sec) : 0;
  await redis.set(balanceKey(uid), sec);
  return sec;
}

// ---------- 阿里云 RPC 公共调用（签名：HMAC-SHA1，纯 node crypto，与支付宝 RSA2 同思路）----------
// 阿里云 RPC 的百分号编码：RFC3986，保留 -_.~，其余一律 %XX（+ 必须编成 %20）
function aliPercentEncode(v) {
  return encodeURIComponent(String(v)).replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
}

function aliRpcSign(params, accessKeySecret) {
  const canonical = Object.keys(params)
    .filter(k => k !== 'Signature' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => aliPercentEncode(k) + '=' + aliPercentEncode(params[k]))
    .join('&');
  const stringToSign = 'POST&' + aliPercentEncode('/') + '&' + aliPercentEncode(canonical);
  const sign = crypto.createHmac('sha1', accessKeySecret + '&').update(stringToSign, 'utf8').digest('base64');
  return { sign, canonical };
}

// dysmsapi 与 dypnsapi 的 API 版本同为 2017-05-25，签名风格同为 RPC
async function aliRpcCall(action, biz) {
  const https = require('https');
  const a = cfg.aliyun;
  const params = Object.assign({
    Action: action,
    Version: '2017-05-25',
    Format: 'JSON',
    AccessKeyId: a.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), // UTC，形如 2026-11-12T02:11:04Z
    RegionId: a.region,
  }, biz);
  const { sign } = aliRpcSign(params, a.accessKeySecret);
  params.Signature = sign;
  // 提交串也按 key 字典序拼，与待签串保持一致，便于排障时逐字比对
  const body = Object.keys(params)
    .filter(k => params[k] !== '' && params[k] != null)
    .sort()
    .map(k => aliPercentEncode(k) + '=' + aliPercentEncode(params[k]))
    .join('&');

  return new Promise((resolve) => {
    const req = https.request({
      host: aliEndpoint(), path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(raw); } catch (e) { /* 非 JSON 响应按未知码处理 */ }
        // Code=OK 只代表阿里云受理了提交，终端送达是异步的；核验结果另看 Model.VerifyResult
        resolve({ ok: j.Code === 'OK', code: j.Code || ('HTTP_' + res.statusCode), msg: j.Message || '', data: j });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('aliyun sms timeout')); });
    req.on('error', (e) => resolve({ ok: false, code: 'NETWORK_ERROR', msg: e.message, data: {} }));
    req.end(body);
  });
}

// 通道一：短信服务 Dysmsapi。验证码由我们自己生成，TemplateParam 直接填具体值
async function sendSms(phone, templateParam) {
  const a = cfg.aliyun;
  return aliRpcCall('SendSms', {
    PhoneNumbers: phone,
    SignName: a.signName,
    TemplateCode: a.templateCode,
    TemplateParam: templateParam ? JSON.stringify(templateParam) : undefined,
  });
}

// 通道二：号码认证服务 PNVS。验证码位置传占位符 ##code##，由阿里云生成（占位符时 CodeType 必填），
// 核验也只能走 CheckSmsVerifyCode——自己填具体验证码时阿里云无法核验。
function pnvsTemplateParam() {
  const a = cfg.aliyun;
  if (a.templateParam) return a.templateParam; // 需与赠送模板的变量完全一致，多传/少传都会被判非法参数
  return JSON.stringify({ code: '##code##', min: String(Math.max(1, Math.round(a.validTime / 60))) });
}

async function pnvsSendCode(phone, opts = {}) {
  const a = cfg.aliyun;
  const r = await aliRpcCall('SendSmsVerifyCode', {
    PhoneNumber: phone,
    CountryCode: '86',
    SchemeName: a.schemeName || undefined,
    SignName: a.signName,
    TemplateCode: a.templateCode,
    TemplateParam: pnvsTemplateParam(),
    CodeType: a.codeType,
    CodeLength: a.codeLength,
    ValidTime: a.validTime,
    Interval: a.interval,
    DuplicatePolicy: 1,             // 同号重发时旧码失效
    ReturnVerifyCode: opts.returnCode ? 'true' : undefined, // 仅调试用，将验证码回传便于联调
  });
  if (r.ok) r.verifyCode = (r.data.Model && r.data.Model.VerifyCode) || '';
  return r;
}

// 核验：阿里云明确说明 Code=OK 不代表核验通过，只以 Model.VerifyResult === 'PASS' 为准
async function pnvsCheckCode(phone, code) {
  const a = cfg.aliyun;
  const r = await aliRpcCall('CheckSmsVerifyCode', {
    PhoneNumber: phone,
    CountryCode: '86',
    SchemeName: a.schemeName || undefined,
    VerifyCode: code,
  });
  r.pass = r.ok && r.data.Model && r.data.Model.VerifyResult === 'PASS';
  return r;
}

// ---------- 支付宝签名 / 验签（RSA2 / SHA256withRSA，纯 node crypto）----------
function normalizePem(key, kind) {
  if (/BEGIN/.test(key)) return key;
  const header = kind === 'private' ? 'PRIVATE KEY' : 'PUBLIC KEY';
  const body = key.replace(/\s/g, '').replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return '-----BEGIN ' + header + '-----\n' + body + '\n-----END ' + header + '-----';
}

// 参数按 key 字典序拼接，排除 sign / sign_type / 空值
function buildSignStr(params) {
  return Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => k + '=' + params[k])
    .join('&');
}

function alipaySign(params) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(buildSignStr(params), 'utf8');
  return sign.sign(normalizePem(cfg.alipay.privateKey, 'private'), 'base64');
}

// 回调验签：去掉 sign / sign_type 后拼串，用支付宝公钥校验
function alipayVerifyNotify(postData) {
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(buildSignStr(postData), 'utf8');
  return verify.verify(normalizePem(cfg.alipay.publicKey, 'public'), postData.sign, 'base64');
}

module.exports = {
  cfg, pool, redis, ok, fail, signToken, auth,
  balanceKey, grantPaidOrder, syncBalanceToRedis,
  alipaySign, alipayVerifyNotify,
  sendSms, pnvsSendCode, pnvsCheckCode, smsConfigured, smsMode,
};
