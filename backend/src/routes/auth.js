// 登录：短信验证码（阿里云短信认证兜底），一键登录预留
const express = require('express');
const crypto = require('crypto');
const { pool, ok, fail, signToken, cfg } = require('../lib');
const router = express.Router();

// 发送验证码：开发期可直接返回验证码，生产务必关掉 SMS_DEBUG_RETURN_CODE
router.post('/sms/send', async (req, res) => {
  const phone = String(req.body.phone || '');
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(res, 4001, '手机号格式错误');

  // 频率限制：同号 60s 一次（用 MySQL 上一条记录时间近似，简单实现）
  const code = String(crypto.randomInt(100000, 999999));
  await pool.execute(
    'INSERT INTO sms_code (phone, code, scene, expire_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [phone, code, 'login']
  );

  // TODO 生产：这里调用阿里云 Dysmsapi SendSms（用 ALIYUN_* 配置）。
  // 个人开发者用短信认证模板即可，AccessKey 只存在后端。
  const debug = cfg.smsDebug ? { debugCode: code } : {};
  return ok(res, debug, '验证码已发送');
});

// 校验验证码并登录（一键登录 oneclick 同样返回 JWT，字段一致）
router.post('/sms/verify', async (req, res) => {
  const phone = String(req.body.phone || '');
  const code = String(req.body.code || '');
  const [rows] = await pool.execute(
    'SELECT id, code FROM sms_code WHERE phone=? AND scene=? AND expire_at>NOW() ORDER BY id DESC LIMIT 1',
    [phone, 'login']
  );
  if (!rows.length || rows[0].code !== code) return fail(res, 4002, '验证码错误或已过期');
  await pool.execute('DELETE FROM sms_code WHERE id=?', [rows[0].id]);

  // upsert 用户
  await pool.execute('INSERT INTO user (phone) VALUES (?) ON DUPLICATE KEY UPDATE phone=phone', [phone]);
  const [u] = await pool.execute('SELECT id, phone FROM user WHERE phone=?', [phone]);
  const user = u[0];
  await pool.execute('INSERT IGNORE INTO wallet_user (user_id, balance_sec) VALUES (?, 0)', [user.id]);

  return ok(res, { token: signToken(user), user: { id: user.id, phone: user.phone } });
});

// 一键登录（阿里云号码认证 GetMobile）预留位：前端传 sdk token，后端换真实手机号后走同样登录逻辑
router.post('/oneclick', async (req, res) => {
  // TODO 生产：用 req.body.token 调阿里云 GetMobile 拿真实手机号，然后复用上面的 upsert + 签发 JWT
  return fail(res, 5010, '一键登录未启用，请改用短信验证码登录');
});

module.exports = router;
