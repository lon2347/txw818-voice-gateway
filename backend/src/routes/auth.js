// 登录：短信验证码（号码认证服务 PNVS / 短信服务 Dysmsapi 两通道），一键登录预留
const express = require('express');
const crypto = require('crypto');
const { pool, redis, ok, fail, signToken, cfg, sendSms, smsMode, pnvsSendCode, pnvsCheckCode } = require('../lib');
const router = express.Router();

// 发送验证码：开发期可直接返回验证码，生产务必关掉 SMS_DEBUG_RETURN_CODE
router.post('/sms/send', async (req, res) => {
  const phone = String(req.body.phone || '');
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(res, 4001, '手机号格式错误');

  const mode = smsMode(); // 'dypnsapi' | 'dysmsapi' | 'off'

  // 通道一：号码认证服务 PNVS——验证码由阿里云生成、也由阿里云核验，本地不写 sms_code。
  // Redis 先做一次频控，避开无谓的 API 调用；阿里云侧的 Interval 是第二道保险。
  if (mode === 'dypnsapi') {
    const cdKey = 'sms:cooldown:' + phone;
    const got = await redis.set(cdKey, '1', 'EX', cfg.aliyun.interval, 'NX');
    if (!got) return fail(res, 4290, '验证码发送过于频繁，请 ' + cfg.aliyun.interval + ' 秒后再试');
    const r = await pnvsSendCode(phone, { returnCode: cfg.smsDebug });
    if (!r.ok) {
      await redis.del(cdKey); // 没发出去就别锁住用户
      console.error('[sms] 号码认证下发失败', phone, r.code, r.msg);
      if (r.code === 'FREQUENCY_FAIL' || r.code === 'BUSINESS_LIMIT_CONTROL') {
        return fail(res, 4290, '验证码发送过于频繁，请稍后再试');
      }
      return fail(res, 5011, '短信发送失败：' + r.code);
    }
    const debug = cfg.smsDebug
      ? { debugCode: r.verifyCode || '', smsGatewayConfigured: true, sent: true, note: '验证码由阿里云生成，debugCode 仅供联调' }
      : {};
    return ok(res, debug, '验证码已发送');
  }

  // 通道二（短信服务 Dysmsapi）与未配置通道时：验证码自己生成、写 sms_code、自己比对
  // 频率限制：同号 60s 一次（上一条验证码的创建时间近似，避免短信费用被刷）
  const [recent] = await pool.execute(
    'SELECT created_at FROM sms_code WHERE phone=? AND scene=? ORDER BY id DESC LIMIT 1',
    [phone, 'login']
  );
  if (recent.length && (Date.now() - new Date(recent[0].created_at).getTime()) < 60000) {
    return fail(res, 4290, '验证码发送过于频繁，请 60 秒后再试');
  }

  const code = String(crypto.randomInt(100000, 999999));
  await pool.execute(
    'INSERT INTO sms_code (phone, code, scene, expire_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [phone, code, 'login']
  );

  // Dysmsapi：ALIYUN_* 四项填齐后真实下发（签名/模板审核通过）。下发失败则直接报错。
  let sent = false;
  if (mode === 'dysmsapi') {
    const r = await sendSms(phone, { code });
    sent = r.ok;
    if (!sent) {
      await pool.execute('DELETE FROM sms_code WHERE phone=? AND scene=?', [phone, 'login']);
      console.error('[sms] 阿里云下发失败', phone, r.code, r.msg);
      return fail(res, 5011, '短信发送失败：' + r.code);
    }
  }

  // 既未配置短信通道，又关了调试回执：用户不可能拿到验证码，直接报配置缺失，不假装成功
  if (!sent && !cfg.smsDebug) {
    await pool.execute('DELETE FROM sms_code WHERE phone=? AND scene=?', [phone, 'login']);
    return fail(res, 5012, '短信通道未配置，请联系管理员');
  }

  const debug = cfg.smsDebug ? { debugCode: code, smsGatewayConfigured: mode !== 'off', sent } : {};
  if (debug.sent) debug.note = '短信已真实下发，debugCode 仅供联调';
  return ok(res, debug, sent ? '验证码已发送' : '验证码已生成（未配置阿里云短信，仅调试返回）');
});

// 校验验证码并登录（一键登录 oneclick 同样返回 JWT，字段一致）
router.post('/sms/verify', async (req, res) => {
  const phone = String(req.body.phone || '');
  const code = String(req.body.code || '');

  // 号码认证服务：验证码不在我们库里，只能调 CheckSmsVerifyCode 让阿里云核验
  if (smsMode() === 'dypnsapi') {
    const r = await pnvsCheckCode(phone, code);
    if (!r.ok) {
      console.error('[sms] 核验调用失败', phone, r.code, r.msg);
      return fail(res, 5013, '核验服务暂不可用，请稍后重试：' + r.code);
    }
    if (!r.pass) { // 注意：Code=OK 仅代表接口调通，核验结果只看 Model.VerifyResult
      console.warn('[sms] 核验未通过', phone, r.data && r.data.Model && r.data.Model.VerifyResult);
      return fail(res, 4002, '验证码错误或已过期');
    }
    return loginByPhone(phone, res);
  }

  const [rows] = await pool.execute(
    'SELECT id, code FROM sms_code WHERE phone=? AND scene=? AND expire_at>NOW() ORDER BY id DESC LIMIT 1',
    [phone, 'login']
  );
  if (!rows.length || rows[0].code !== code) return fail(res, 4002, '验证码错误或已过期');
  await pool.execute('DELETE FROM sms_code WHERE id=?', [rows[0].id]);
  return loginByPhone(phone, res);
});

// 核验通过后的统一落库：建用户 + 初始化钱包 + 签发 JWT
async function loginByPhone(phone, res) {
  // upsert 用户
  await pool.execute('INSERT INTO user (phone) VALUES (?) ON DUPLICATE KEY UPDATE phone=phone', [phone]);
  const [u] = await pool.execute('SELECT id, phone FROM user WHERE phone=?', [phone]);
  const user = u[0];
  await pool.execute('INSERT IGNORE INTO wallet_user (user_id, balance_sec) VALUES (?, 0)', [user.id]);

  return ok(res, { token: signToken(user), user: { id: user.id, phone: user.phone } });
}

// 一键登录（阿里云号码认证 GetMobile）预留位：前端传 sdk token，后端换真实手机号后走同样登录逻辑
router.post('/oneclick', async (req, res) => {
  // TODO 生产：用 req.body.token 调阿里云 GetMobile 拿真实手机号，然后复用上面的 upsert + 签发 JWT
  return fail(res, 5010, '一键登录未启用，请改用短信验证码登录');
});

module.exports = router;
