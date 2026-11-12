-- 01_base_schema.sql: 语音网关基础表结构
CREATE DATABASE IF NOT EXISTS `voice_gateway` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `voice_gateway`;

-- 1. 设备出厂表
CREATE TABLE IF NOT EXISTS `device` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `device_id` VARCHAR(64) NOT NULL UNIQUE,
  `model` VARCHAR(32) NOT NULL DEFAULT 'TXW818',
  `status` ENUM('unbound', 'bound', 'disabled') NOT NULL DEFAULT 'unbound',
  `secret` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_device_id (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 套餐表 (加油包)
CREATE TABLE IF NOT EXISTS `pkg` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(64) NOT NULL,
  `minutes` INT NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `on_sale` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 初始充值加油包
INSERT INTO `pkg` (`id`, `name`, `minutes`, `price`, `on_sale`) VALUES
  (1, '60分钟加油包', 60, 9.90, 1),
  (2, '300分钟加油包', 300, 39.90, 1),
  (3, '1000分钟加油包', 1000, 99.00, 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `minutes`=VALUES(`minutes`), `price`=VALUES(`price`);

-- 4. 采购订单表
CREATE TABLE IF NOT EXISTS `purchase_order` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `order_no` VARCHAR(64) NOT NULL UNIQUE,
  `pkg_id` INT NULL,
  `status` ENUM('pending', 'paid', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  `paid_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_no (`order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. 语音会话计费流水表
CREATE TABLE IF NOT EXISTS `voice_session` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(64) NOT NULL UNIQUE,
  `device_id` VARCHAR(64) NOT NULL,
  `seconds` INT NOT NULL DEFAULT 0,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` DATETIME NULL,
  INDEX idx_device (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 预置测试设备，方便联调扫码体验
INSERT INTO `device` (`device_id`, `model`, `status`) VALUES
  ('TXW818-ABC123', 'TXW818', 'unbound'),
  ('TXW818-DEMO01', 'TXW818', 'unbound')
ON DUPLICATE KEY UPDATE `model`=VALUES(`model`);
