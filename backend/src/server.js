// backend 入口：挂载路由，监听 9100（仅内网，由 Nginx 反代对外）
const express = require('express');
const { cfg } = require('./lib');

const app = express();
app.disable('x-powered-by');

// 支付宝异步通知是 application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/healthz', (req, res) => res.send('ok'));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/devices', require('./routes/device'));
app.use('/api/orders', require('./routes/order'));
app.use('/api', require('./routes/wallet'));
app.use('/pay/alipay', require('./routes/pay'));

app.use((err, req, res, next) => {
  console.error('[backend error]', err);
  res.status(200).json({ code: 500, msg: '服务内部错误' });
});

app.listen(cfg.port, () => console.log('voice-backend listening on ' + cfg.port));
