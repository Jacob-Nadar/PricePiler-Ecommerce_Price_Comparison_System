-- PricePiler database schema (generated from server/db/migrations/*.sql).
-- Preferred: run `npm run migrate` (creates the database and tracks migrations).
-- Alternative for phpMyAdmin / XAMPP: import this file.

CREATE DATABASE IF NOT EXISTS price_comparison CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE price_comparison;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ===== 001_initial_schema.sql =====
-- PricePiler schema: retailers, products, listings, price history, users, auth,
-- saved products, price alerts, stock alerts and notification logs.
-- Applied by `npm run migrate` (server/db/migrate.js). Safe to run on a new, empty database.

CREATE TABLE IF NOT EXISTS retailers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) NOT NULL,
  base_url VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_retailers_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO retailers (name, slug, base_url) VALUES
  ('Amazon India', 'amazon_in', 'https://www.amazon.in'),
  ('Flipkart', 'flipkart', 'https://www.flipkart.com'),
  ('Myntra', 'myntra', 'https://www.myntra.com');

-- A product groups equivalent listings across retailers.
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  normalized_name VARCHAR(500) NOT NULL,
  brand VARCHAR(150) NULL,
  category VARCHAR(150) NULL,
  image_url VARCHAR(1000) NULL,
  specifications JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_norm_name (normalized_name(191)),
  INDEX idx_products_brand (brand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One retailer page for one product variant. listing_key is a stable identity
-- derived from the URL (e.g. "amazon_in|amazon:B0CHX1W1XY"), so colour/size/storage
-- variants with their own URLs keep separate histories.
CREATE TABLE IF NOT EXISTS product_listings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  retailer_id INT NOT NULL,
  listing_key VARCHAR(255) NOT NULL,
  external_id VARCHAR(255) NULL,
  title VARCHAR(500) NOT NULL,
  product_url VARCHAR(1000) NOT NULL,
  image_url VARCHAR(1000) NULL,
  variant_label VARCHAR(255) NULL,
  specifications JSON NULL,
  current_price DECIMAL(12,2) NULL,
  mrp DECIMAL(12,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  availability ENUM('in_stock','out_of_stock','unknown') NOT NULL DEFAULT 'unknown',
  rating DECIMAL(2,1) NULL,
  rating_count INT NULL,
  last_checked_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  last_error_at DATETIME NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  next_check_at DATETIME NULL,
  lock_token CHAR(32) NULL,
  locked_until DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_listings_key (listing_key),
  INDEX idx_listings_product (product_id),
  INDEX idx_listings_retailer (retailer_id),
  INDEX idx_listings_next_check (next_check_at),
  CONSTRAINT fk_listings_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_listings_retailer FOREIGN KEY (retailer_id) REFERENCES retailers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Price snapshots. Only rows with a valid price are stored; unchanged prices are
-- written at most once per heartbeat interval (see priceHistoryService).
CREATE TABLE IF NOT EXISTS price_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  listing_id INT NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  mrp DECIMAL(12,2) NULL,
  availability ENUM('in_stock','out_of_stock','unknown') NOT NULL DEFAULT 'unknown',
  source ENUM('search','scheduled','manual') NOT NULL DEFAULT 'search',
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ph_listing_time (listing_id, recorded_at),
  CONSTRAINT fk_ph_listing FOREIGN KEY (listing_id) REFERENCES product_listings(id) ON DELETE CASCADE,
  CONSTRAINT chk_ph_price CHECK (price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  email_verified_at DATETIME NOT NULL,
  login_otp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One live OTP per email + purpose. Registration details wait in `payload` until
-- the email is verified, so no account exists before verification.
CREATE TABLE IF NOT EXISTS email_otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  purpose ENUM('register','login','reset') NOT NULL,
  code_hash CHAR(64) NOT NULL,
  payload JSON NULL,
  attempts INT NOT NULL DEFAULT 0,
  send_count INT NOT NULL DEFAULT 1,
  send_window_started_at DATETIME NOT NULL,
  last_sent_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_otps_email_purpose (email, purpose),
  INDEX idx_otps_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions; the cookie holds a random token, the database only its SHA-256.
CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sessions_token (token_hash),
  INDEX idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  client_key VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_saved_user_product (user_id, product_id),
  CONSTRAINT fk_saved_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- listing_id NULL = watch the product at every retailer. scope_key (= listing_id,
-- or 0 for all retailers; set by the app) makes "one alert per user/product/scope"
-- enforceable despite NULLs. Works on MySQL 8 and MariaDB 10.4+ (XAMPP).
-- notify_cycle increments each time the price goes back above target, so each
-- separate drop gets its own notification event key.
CREATE TABLE IF NOT EXISTS price_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  listing_id INT NULL,
  scope_key INT NOT NULL DEFAULT 0,
  target_price DECIMAL(12,2) NOT NULL,
  status ENUM('active','triggered','paused','cancelled') NOT NULL DEFAULT 'active',
  notify_cycle INT NOT NULL DEFAULT 0,
  price_at_creation DECIMAL(12,2) NULL,
  last_seen_price DECIMAL(12,2) NULL,
  last_notified_at DATETIME NULL,
  last_notified_price DECIMAL(12,2) NULL,
  last_notified_listing_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_price_alert_scope (user_id, product_id, scope_key),
  INDEX idx_price_alerts_product_status (product_id, status),
  CONSTRAINT fk_pa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_listing FOREIGN KEY (listing_id) REFERENCES product_listings(id) ON DELETE CASCADE,
  CONSTRAINT chk_pa_target CHECK (target_price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status 'notified' = restock email sent; it re-arms to 'active' only after a
-- confirmed out-of-stock check, so a listing that stays available is not re-notified.
CREATE TABLE IF NOT EXISTS stock_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  listing_id INT NOT NULL,
  retailer_id INT NOT NULL,
  status ENUM('active','notified','paused','cancelled') NOT NULL DEFAULT 'active',
  notify_cycle INT NOT NULL DEFAULT 0,
  last_notified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stock_alert_user_listing (user_id, listing_id),
  INDEX idx_stock_alerts_listing_status (listing_id, status),
  CONSTRAINT fk_sa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_listing FOREIGN KEY (listing_id) REFERENCES product_listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_retailer FOREIGN KEY (retailer_id) REFERENCES retailers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every email attempt. event_key is unique, so a price-drop or restock event can
-- only ever be claimed (and emailed) once, even if two monitor runs overlap.
CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  type ENUM('price_drop','back_in_stock','otp_register','otp_login','otp_reset') NOT NULL,
  event_key VARCHAR(191) NULL,
  price_alert_id INT NULL,
  stock_alert_id INT NULL,
  listing_id INT NULL,
  subject VARCHAR(255) NOT NULL,
  status ENUM('pending','sent','logged','failed') NOT NULL DEFAULT 'pending',
  error VARCHAR(500) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  UNIQUE KEY uq_notification_event (event_key),
  INDEX idx_notifications_user_time (user_id, created_at),
  CONSTRAINT fk_nl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nl_listing FOREIGN KEY (listing_id) REFERENCES product_listings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS search_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  query VARCHAR(500) NOT NULL,
  source ENUM('manual','url') NOT NULL DEFAULT 'manual',
  results_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sh_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (name) VALUES ('001_initial_schema.sql');

-- ===== 002_admin.sql =====
-- Admin role, account disabling, and an audit trail of admin actions.

ALTER TABLE users
  ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER password_hash,
  ADD COLUMN disabled_at DATETIME NULL AFTER locked_until,
  ADD INDEX idx_users_role (role);

-- Every change an admin makes (disable a user, delete an alert, ...) is recorded.
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  admin_user_id INT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(64) NULL,
  details JSON NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_time (created_at),
  INDEX idx_audit_admin (admin_user_id),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (name) VALUES ('002_admin.sql');

