// 支付宝异步回调：验签 -> 业务校验 -> 幂等锁 -> 事务发放 -> 返回 success
const express = require('express');
const { pool, redis, ok, cfg, alipayVerifyNotify, grantPaidOrder, syncBalanceToRedis } = require('../lib');
const router = express.Router();

// 铁律：加余额只能发生在这里，且必须验签通过。前端任何“已支付”声明都不作数。
router.post('/notify', express.text({ type: '*/*' }), async (req, res) => {
  // express.urlencoded 已把 form 解析进 req.body；这里统一拿到对象
  const data = req.body && typeof req.body === 'object' ? req.body : {};

  // 1) 验签
  let pass = false;
  try { pass = alipayVerifyNotify(data); } catch (e) { pass = false; }
  if (!data.sign || !pass) { console.warn('[pay] 验签失败', data.out_trade_no); return res.send('failure'); }

  // 2) 业务四校验：app_id / 交易状态 / 金额 / 订单存在
  const [orders] = await pool.execute('SELECT * FROM purchase_order WHERE order_no=?', [data.out_trade_no]);
  if (!orders.length) { console.warn('[pay] 订单不存在', data.out_trade_no); return res.send('success'); }
  const order = orders[0];
  if (data.app_id && cfg.alipay.appId && data.app_id !== cfg.alipay.appId) return res.send('failure');
  if (data.trade_status !== 'TRADE_SUCCESS') return res.send('success'); // 非成功态直接 ack
  if (Number(data.total_amount).toFixed(2) !== Number(order.amount).toFixed(2)) {
    console.warn('[pay] 金额不符', data.total_amount, order.amount); return res.send('failure');
  }

  // 3) 幂等锁：SETNX order_no，防止支付宝重复回调并发发放
  const lockKey = 'pay:lock:' + data.out_trade_no;
  const locked = await redis.set(lockKey, '1', 'EX', 600, 'NX');
  if (!locked) return res.send('success'); // 已在处理/已处理

  // 4) 事务内发放权益
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const gained = await grantPaidOrder(conn, {
      orderNo: order.order_no, userId: order.user_id, minutes: order.minutes, tradeNo: data.trade_no,
    });
    await conn.commit();
    // 5) 同步余额到 Redis，网关下次接入即可读到新余额
    if (gained > 0) await syncBalanceToRedis(order.user_id);
    // 记录回调流水（pay_notify_log 可选表，缺表时忽略）
    await pool.execute(
      'INSERT INTO pay_notify_log (order_no, trade_no, raw) VALUES (?, ?, ?)',
      [order.order_no, data.trade_no, JSON.stringify(data)]
    ).catch(() => {});
    return res.send('success');
  } catch (e) {
    await conn.rollback();
    await redis.del(lockKey); // 失败释放锁，允许支付宝重试
    console.error('[pay] 发放失败', e);
    return res.send('failure');
  } finally {
    conn.release();
  }
});

module.exports = router;
