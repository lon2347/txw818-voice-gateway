// 公共基础设施：配置、MySQL、Redis、JWT、统一响应、支付宝签名/验签
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
};

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
};
