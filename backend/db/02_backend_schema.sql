-- backend 增量迁移：在 voice-gateway-deploy 的 01_schema.sql 基础上执行
-- 若某列已存在，MySQL 8 会报 duplicate column，忽略该行即可（或用 ALTER ... ADD COLUMN IF NOT EXISTS，MariaDB 支持）

-- 1) 用户表
CREATE TABLE IF NOT EXISTS user (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(20) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) 短信验证码
CREATE TABLE IF NOT EXISTS sms_code (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(10) NOT NULL,
  scene VARCHAR(20) NOT NULL DEFAULT 'login',
  expire_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_phone_scene (phone, scene)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) 用户钱包（余额权威值在 Redis，这里落快照，按 user 维度计时长）
CREATE TABLE IF NOT EXISTS wallet_user (
  user_id BIGINT PRIMARY KEY,
  balance_sec BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) 支付回调流水（幂等与对账留痕）
CREATE TABLE IF NOT EXISTS pay_notify_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(64) NOT NULL,
  trade_no VARCHAR(64),
  raw TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_order (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) device 绑定归属：加 user_id
ALTER TABLE device ADD COLUMN user_id BIGINT NULL;
ALTER TABLE device ADD INDEX idx_user (user_id);

-- 6) purchase_order：补 backend 下单/回调所需列
ALTER TABLE purchase_order ADD COLUMN user_id BIGINT NULL;
ALTER TABLE purchase_order ADD COLUMN minutes INT NULL;
ALTER TABLE purchase_order ADD COLUMN amount DECIMAL(10,2) NULL;
ALTER TABLE purchase_order ADD COLUMN subject VARCHAR(120) NULL;
ALTER TABLE purchase_order ADD COLUMN alipay_trade_no VARCHAR(64) NULL;
ALTER TABLE purchase_order ADD INDEX idx_user (user_id);

-- 7) pkg（加油包）：确认存在以下列；若 01_schema 已建 pkg 且列名不同，请对齐 name/minutes/price/on_sale
--    如缺失可取消下面注释补建：
-- CREATE TABLE IF NOT EXISTS pkg (
--   id INT PRIMARY KEY AUTO_INCREMENT,
--   name VARCHAR(60) NOT NULL,
--   minutes INT NOT NULL,
--   price DECIMAL(10,2) NOT NULL,
--   on_sale TINYINT NOT NULL DEFAULT 1
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- INSERT INTO pkg (name, minutes, price) VALUES
--   ('60分钟加油包', 60, 9.90), ('300分钟加油包', 300, 39.90), ('1000分钟加油包', 1000, 99.00);

-- 8) 下单状态：确保 purchase_order.status 支持 pending / paid
--    （若原为 ENUM，请包含 'pending','paid'）
