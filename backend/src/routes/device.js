// 设备：扫码解析 + 绑定 + 我的设备
const express = require('express');
const { pool, ok, fail, auth } = require('../lib');
const router = express.Router();

// 扫码后前端拿 device_id 调这个：查设备是否存在、是否已被他人绑定（公开，仅返回安全信息）
router.post('/resolve', async (req, res) => {
  const deviceId = String(req.body.device_id || '');
  const [rows] = await pool.execute(
    'SELECT device_id, status, user_id FROM device WHERE device_id=?', [deviceId]
  );
  if (!rows.length) return fail(res, 4040, '设备不存在，请核对设备编号');
  const d = rows[0];
  // user_id 非空即已被绑定（当前用户重新登录自己设备的场景由后端在 bind 时放行）
  return ok(res, { device_id: d.device_id, bound: !!d.user_id, status: d.status });
});

// 绑定设备（需登录）
router.post('/bind', auth, async (req, res) => {
  const deviceId = String(req.body.device_id || '');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      'SELECT id, user_id FROM device WHERE device_id=? FOR UPDATE', [deviceId]
    );
    if (!rows.length) { await conn.rollback(); return fail(res, 4040, '设备不存在'); }
    const d = rows[0];
    if (d.user_id && Number(d.user_id) !== req.user.uid) {
      await conn.rollback(); return fail(res, 4090, '该设备已被其他账号绑定');
    }
    await conn.execute('UPDATE device SET user_id=?, status=? WHERE id=?', [req.user.uid, 'bound', d.id]);
    await conn.commit();
    return ok(res, { device_id: deviceId }, '绑定成功');
  } catch (e) {
    await conn.rollback(); throw e;
  } finally {
    conn.release();
  }
});

// 我的设备列表
router.get('/', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT device_id, status, created_at FROM device WHERE user_id=?', [req.user.uid]
  );
  return ok(res, rows);
});

module.exports = router;
