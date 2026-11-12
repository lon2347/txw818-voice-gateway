// 套餐列表 + 下单（返回支付宝跳转 URL）+ 订单轮询
const express = require('express');
const crypto = require('crypto');
const { pool, ok, fail, auth, cfg, alipaySign } = require('../lib');
const router = express.Router();

// 加油包列表（公开）
router.get('/packages', async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, name, minutes, price FROM pkg WHERE on_sale=1 ORDER BY price ASC'
  );
  return ok(res, rows);
});

// 下单（需登录）：创建 pending 订单，拼出支付宝电脑网站支付跳转地址
router.post('/', auth, async (req, res) => {
  const pkgId = Number(req.body.pkg_id);
  const [pk] = await pool.execute('SELECT id,name,minutes,price FROM pkg WHERE id=? AND on_sale=1', [pkgId]);
  if (!pk.length) return fail(res, 4041, '套餐不存在或已下架');
  const pkg = pk[0];

  const orderNo = 'V' + Date.now() + crypto.randomBytes(3).toString('hex').toUpperCase();
  await pool.execute(
    'INSERT INTO purchase_order (order_no, user_id, pkg_id, minutes, amount, subject, status) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)',
    [orderNo, req.user.uid, pkg.id, pkg.minutes, pkg.price, pkg.name, 'pending']
  );

  // Vibe Pay / 支付宝个人开发者能力：移动端自适应 WAP 手机支付，桌面端使用电脑网站支付
  const ua = req.headers['user-agent'] || '';
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const method = isMobile ? 'alipay.trade.wap.pay' : 'alipay.trade.page.pay';
  const productCode = isMobile ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY';

  // 组装支付宝订单参数
  const bizContent = JSON.stringify({
    out_trade_no: orderNo,
    total_amount: Number(pkg.price).toFixed(2),
    subject: pkg.name,
    product_code: productCode,
  });
  const params = {
    app_id: cfg.alipay.appId,
    method: method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    version: '1.0',
    notify_url: cfg.alipay.notifyUrl,
    return_url: cfg.alipay.returnUrl,
    biz_content: bizContent,
  };
  params.sign = alipaySign(params);
  params.sign_type = 'RSA2';

  const qs = Object.keys(params).map(k =>
    encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const payUrl = cfg.alipay.gateway + '?' + qs;

  return ok(res, { order_no: orderNo, pay_url: payUrl });
});

// 轮询订单状态（需登录）：前端支付后轮询到 paid 即认为权益已到账
router.get('/:orderNo', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT order_no, status, paid_at FROM purchase_order WHERE order_no=? AND user_id=?',
    [req.params.orderNo, req.user.uid]
  );
  if (!rows.length) return fail(res, 4040, '订单不存在');
  return ok(res, rows[0]);
});

module.exports = router;
