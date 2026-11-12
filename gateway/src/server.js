// TXW818 语音网关服务（WS 8080）
const http = require('http');
const { WebSocketServer } = require('ws');
const Redis = require('ioredis');

const PORT = parseInt(process.env.PORT || '8080', 10);
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('error', (err) => console.warn('[Gateway Redis Warn]', err.message));

const server = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('gateway ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith('/v1/voice/')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (ws, req) => {
  console.log('[Gateway WSS] New incoming connection from:', req.socket.remoteAddress);

  // 解析设备 ID 或鉴权 Token
  const url = new URL(req.url, `http://${req.headers.host}`);
  const deviceId = url.searchParams.get('device_id') || 'TXW818-DEFAULT';
  const userId = url.searchParams.get('user_id') || '1';

  // 1) 准入校验：查 Redis 权威实时余额
  try {
    const balanceKey = `voice:balance:user:${userId}`;
    const balance = await redis.get(balanceKey);
    const balanceSec = balance ? parseInt(balance, 10) : 0;

    if (balanceSec <= 0) {
      console.warn(`[Gateway WSS] 拒接入: 用户 ${userId} 余额为 ${balanceSec} 秒，时长不足`);
      ws.send(JSON.stringify({ type: 'error', code: 402, msg: '账户语音时长不足，请充值加油包' }));
      ws.close(4402, 'Insufficient Balance');
      return;
    }

    console.log(`[Gateway WSS] 准入通过: 用户 ${userId} 实时余额 ${balanceSec} 秒`);
    ws.send(JSON.stringify({ type: 'ready', device_id: deviceId, balance_sec: balanceSec }));

    // 2) 会话心跳与计费模拟（按秒扣费）
    const deductTimer = setInterval(async () => {
      if (ws.readyState !== ws.OPEN) {
        clearInterval(deductTimer);
        return;
      }
      try {
        // Lua 脚本原子扣 1 秒，若 <= 0 则停止
        const res = await redis.eval(
          `local cur = redis.call('get', KEYS[1])
           if not cur or tonumber(cur) <= 0 then
             return -1
           else
             return redis.call('decrby', KEYS[1], ARGV[1])
           end`,
          1, balanceKey, 1
        );

        if (res < 0) {
          clearInterval(deductTimer);
          ws.send(JSON.stringify({ type: 'error', code: 402, msg: '时长已耗尽' }));
          ws.close(4402, 'Balance Depleted');
        }
      } catch (err) {
        console.error('[Gateway WSS Deduct Error]', err);
      }
    }, 1000);

    ws.on('close', () => {
      clearInterval(deductTimer);
      console.log('[Gateway WSS] 会话关闭, device:', deviceId);
    });

    ws.on('message', (data) => {
      // 模拟上游转发：接收到音频帧，回显或透传腾讯
      // 在生产环境中在此处连接腾讯云 Speech-to-Speech WSS
    });
  } catch (e) {
    console.error('[Gateway WSS Init Error]', e);
    ws.close(1011, 'Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`TXW818 Voice Gateway listening on port ${PORT}`);
});

