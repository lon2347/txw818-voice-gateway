// 余额 + 账单（均需登录）
const express = require('express');
const { pool, ok, auth, balanceKey, redis } = require('../lib');
const router = express.Router();

// 余额（优先读 Redis 权威值，回落 MySQL）
router.get('/wallet', auth, async (req, res) => {
  let sec = await redis.get(balanceKey(req.user.uid));
  if (sec == null) {
    const [rows] = await pool.execute(
      'SELECT balance_sec FROM wallet_user WHERE user_id=?', [req.user.uid]
    );
    sec = rows.length ? rows[0].balance_sec : 0;
  }
  return ok(res, { balance_sec: Number(sec) });
});

// 账单流水：购买记录 + 使用扣费记录
router.get('/bills', auth, async (req, res) => {
  const [orders] = await pool.execute(
    'SELECT order_no, subject, amount, status, paid_at FROM purchase_order WHERE user_id=? ORDER BY id DESC LIMIT 50',
    [req.user.uid]
  );
  const [bills] = await pool.execute(
    'SELECT s.session_id, s.seconds, s.started_at FROM voice_session s ' +
    'JOIN device d ON d.device_id = s.device_id WHERE d.user_id=? ORDER BY s.id DESC LIMIT 50',
    [req.user.uid]
  );
  return ok(res, { orders, bills });
});

module.exports = router;
