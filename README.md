# PricePiler — E-commerce Price Comparison

Compare live prices for the same product across **Amazon India, Flipkart and Myntra**, track
price history, and get **email alerts** when a price drops or an out-of-stock item is back.

| Layer      | Tech |
|------------|------|
| Frontend   | React 18 + Vite, Tailwind CSS, Recharts |
| Backend    | Node.js + Express |
| Database   | MySQL 8 or MariaDB 10.4+ (XAMPP works) |
| Email      | Nodemailer (Gmail SMTP with an App Password) |
| Scheduling | node-cron (in-process background monitor) |
| Scraping   | Playwright (Chromium) for Amazon/Flipkart, HTTP for Myntra |

---

## 1. Setting up on a new PC

### What to copy

Copy the project folder **without** these (they are big and recreated by setup):

```
client/node_modules/   server/node_modules/   server/.playwright-browsers/   client/dist/
```

`server/.env` holds your passwords — copy it only if the new PC should use the same settings.

### Install the prerequisites

1. **Node.js 18 or newer** (LTS) — <https://nodejs.org>. Check with `node -v`.
2. **A MySQL server** — pick one:
   - **XAMPP**: install, open the XAMPP Control Panel, click **Start** next to *MySQL*.
     User `root`, empty password, port `3306`.
   - **MySQL Community Server 8**: <https://dev.mysql.com/downloads/installer/> — remember the root password.
   - **Docker**: from the project folder run `docker compose up -d` (uses port **3307**, password `pricepiler`).

### Run the setup (one command)

From the project folder:

```bash
npm run setup
```

This installs the server and client packages, downloads the Chromium build the scraper
needs, creates `server/.env` from `server/.env.example` (with a random `OTP_SECRET`) and
creates the database tables if MySQL is reachable.

### Configure `server/.env`

Open `server/.env` and set at least the database login:

| Your MySQL | Settings |
|------------|----------|
| XAMPP | `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=` (empty) |
| MySQL installer | `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=<your root password>` |
| Docker compose | `DB_PORT=3307`, `DB_USER=root`, `DB_PASSWORD=pricepiler` |

Then create the tables (safe to run any time — it only applies what is missing):

```bash
npm run migrate
```

> phpMyAdmin users can instead import `database/schema.sql`.

### Configure email (Gmail)

1. In your Google Account turn on **2-Step Verification** (Security → 2-Step Verification).
2. Go to **Security → App passwords**, create one named "PricePiler" and copy the 16-character password.
3. In `server/.env`:

   ```
   SMTP_USER=your.address@gmail.com
   SMTP_PASS=abcdabcdabcdabcd        # the App Password, no spaces
   MAIL_FROM=PricePiler <your.address@gmail.com>
   ```
4. Test it: `npm run check:email --prefix server -- your.address@gmail.com`

Without `SMTP_USER`/`SMTP_PASS` the app runs in **console mode** (development only): emails
— including OTP codes — are printed in the server terminal and recorded as *Logged*, never
as *Sent*, so you can test every feature before setting up Gmail.

### Create your admin login

There is **no default admin password** in the code (anyone reading the code could use it).
Create your own admin account once MySQL is set up:

```bash
npm run admin:create -- --email you@gmail.com --name "Your Name"
```

It asks for the password with hidden typing (press Enter to have a strong one generated and
shown once). If the email already belongs to a customer, that account is promoted to admin.
Remove admin rights with `npm run admin:create -- --email you@gmail.com --demote`.

Log in on the normal **Log in** page. Admins **always** confirm with an emailed 6-digit code
(printed in the server terminal while email is not configured), then open **/admin** — or use
*Admin panel* in the account menu.

### Start the app

Two terminals, from the project folder:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open <http://localhost:5173>. The API runs on <http://localhost:5000> (`/api/health` shows the
database, email and monitor status).

---

## 2. Features

### Live comparison (no account needed)
Search by name, browse categories or paste an Amazon.in / Flipkart / Myntra link. Results show
the cheapest **in-stock** offer, savings vs other stores, ratings, MRP/discount, filters and sorting.

### Accounts — register & log in with email OTP
- Register with full name, email, password and confirmation (validated in the browser and on the server).
- A **6-digit code** is emailed; it expires after **5 minutes**, can be resent after a **60 s** cooldown,
  at most **5 codes per hour**, and is locked after **5 wrong attempts**.
- The account is created **only after** the email is verified; duplicate emails are rejected.
- Log in with email + password; optional **email code at every login** (toggle on the dashboard).
- **Forgot password**: email code → new password (signs out all other sessions).
- Accounts lock for 15 minutes after 5 wrong passwords.

### Price history
Every search and every scheduled check stores prices in MySQL per **retailer listing** (each
colour/size/storage variant with its own URL has its own history). The product page chart has
7D / 30D / 90D / All ranges, current / previous / lowest / highest price, up/down indicator,
and toggles to compare retailers. Unchanged prices are stored at most once per
`SNAPSHOT_HEARTBEAT_HOURS` so the history stays compact but continuous.

### Price drop alerts
**Set price alert** on any product → target price → *any store (cheapest)* or one store. When a
scheduled check finds the price **≤ target** (and the item is not out of stock), one email is sent
with product, retailer, previous/current/target price and a link. Statuses: **Active, Triggered,
Paused, Cancelled**; edit target, pause, resume, cancel or delete from the dashboard. After a
notification the alert stays *Triggered* (no repeat emails); if the price rises above the target it
re-arms automatically and a later drop notifies again.

### Back-in-stock alerts
On an out-of-stock store listing choose **Notify me when available**. When a check *confirms* it is
in stock, one email is sent (price at that moment + link). A failed or blocked check is "unknown"
and never counts as out-of-stock or restocked. If it sells out again, the subscription re-arms.

### Dashboard
Profile (name, verified email, login-code toggle), counts, tracked products, price alerts, stock
alerts and notification history (with delivery status).

### Admin panel (`/admin`)
For accounts with the admin role only (checked on the server for every request):

| Tab | What you can do |
|-----|-----------------|
| Overview | Users (new/active this week), alerts, emails sent/failed, products, listings, price snapshots, failing listings, last successful check |
| Users | Search/filter customers; open one to see their profile, sessions, tracked products, alerts and emails; **disable / enable**, **sign out everywhere**, **unlock**, **delete** |
| Alerts | Every customer's price and stock alerts; pause, resume or delete |
| Listings | Monitored store listings with price, stock, last success, failure count and last error; **Check now** |
| Emails | Every email sent (codes and alerts) with delivery status and error |
| Audit log | Every admin action: who, what, when, from which IP |

Admin responses never include password hashes, OTP hashes or session tokens. Admins cannot
disable or delete themselves or other admins from the panel (use `admin:create --demote`).

---

## 3. Testing each feature

| Feature | How to test |
|---------|-------------|
| Registration OTP | Sign up → code arrives by email (or in the server terminal in console mode) → enter it → you land on the dashboard. Try a wrong code (attempts left shown), "Resend" (60 s timer), and registering the same email again (rejected). |
| OTP expiry | Wait 5 minutes before entering the code → "This code has expired". |
| Login 2FA | Dashboard → turn on *Email code at login* → log out → log in → enter the emailed code. |
| Password reset | Log in page → *Forgot password?* → code + new password → log in with the new password. |
| Price alert | Search a product → *Price alert* → set a target **above** today's price (so it triggers) → run `npm run monitor:once --prefix server` → one email; run it again → no duplicate. |
| Stock alert | Click *Notify me when available* on an out-of-stock listing → it emails once the next check confirms it is in stock. |
| History | Open a product page; ranges and retailer toggles update the chart. |
| Protection | Log out and open `/dashboard` → redirected to log in. |

Automated tests:

```bash
npm test                                  # unit tests (no database needed)
```

```bash
TEST_DB_PORT=3307 TEST_DB_PASSWORD=pricepiler npm run test:integration --prefix server
```

The integration suite creates and drops its own `pricepiler_test` database and covers OTP
expiry/attempt limits, duplicate registration, login lockout, password reset, cross-site request
blocking, users not being able to reach each other's alerts, price-drop and restock deduplication
(including concurrent runs), failed scrapes never overwriting data, and snapshot deduplication.
It passes on MySQL 8.4 and MariaDB 10.4. (On Windows PowerShell set the variables with
`$env:TEST_DB_PORT=3307; $env:TEST_DB_PASSWORD='pricepiler'` first.)

---

## 4. Background monitoring

The monitor runs inside the API process (`server/jobs/scheduler.js`); the logic is in
`server/services/monitorService.js`, separate from the Express routes.

- Every `MONITOR_CRON` (default every 15 min) it picks listings that someone tracks (saved, price
  alert or stock alert) whose next check is due — each listing every `MONITOR_INTERVAL_MINUTES`
  (default 6 h), up to `MONITOR_BATCH_SIZE` per run.
- Each listing is **claimed with a database lock**, so overlapping runs or several server processes
  never check the same listing at once.
- Requests to the same store are spaced by `MONITOR_REQUEST_DELAY_MS`; temporary failures
  (timeouts, HTTP 429/5xx, blocks) are retried with exponential backoff up to `MONITOR_MAX_RETRIES`.
- A failed check **never overwrites** price or stock; it records `last_error` and backs off
  (15 min, 30, 60 … up to 24 h). `last_success_at` / `last_error` are stored per listing.
- Structured JSON logs: `monitor.check_ok`, `monitor.price_changed`, `monitor.stock_changed`,
  `monitor.check_failed`, `notification.delivered`, `email.failed`, …

Run one pass by hand: `npm run monitor:once --prefix server`. Disable with `MONITOR_ENABLED=false`.

---

## 5. API

All responses use `{ success, data | error }`. Routes under `/api/me` require login (session cookie).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Database, email mode, monitor and store adapter status |
| GET | `/api/products/search?q=…&fresh=1` | Live search (`fresh` skips the 10-min cache) |
| POST | `/api/products/search` | Exact-product search (name, brand, model, specs) |
| POST | `/api/products/extract-url` | Product details from a store link |
| POST | `/api/products/compare` | Compare one product across stores |
| POST | `/api/products/history` | Price history for `{ offers: [{ storeSlug, productUrl }], range }` |
| GET | `/api/products/:id` | Stored product with its listings |
| GET | `/api/products/:id/price-history?range=7d\|30d\|90d\|all` | Stored product history |
| POST | `/api/auth/register` | Start registration (sends OTP) |
| POST | `/api/auth/register/verify` | Verify OTP → create account + session |
| POST | `/api/auth/otp/resend` | Resend `{ email, purpose: register\|login\|reset }` |
| POST | `/api/auth/login` | Log in (may answer `otpRequired`) |
| POST | `/api/auth/login/verify` | Second-factor code |
| POST | `/api/auth/logout` | Log out |
| POST | `/api/auth/password/forgot` | Send reset code |
| POST | `/api/auth/password/reset` | Code + new password |
| GET / PATCH | `/api/auth/me` | Current user / update name or login-code setting |
| GET | `/api/me/dashboard` | Stats, saved products, alerts, recent notifications |
| GET / POST / DELETE | `/api/me/saved[/:productId]` | Tracked products |
| GET / POST / PATCH / DELETE | `/api/me/alerts/price[/:id]` | Price alerts (`action: pause\|resume\|cancel`, `targetPrice`) |
| GET / POST / PATCH / DELETE | `/api/me/alerts/stock[/:id]` | Stock alerts (`action: pause\|resume\|cancel`) |
| GET | `/api/me/notifications?offset&limit` | Notification history |
| GET | `/api/admin/overview`, `/users`, `/users/:id`, `/alerts/price`, `/alerts/stock`, `/listings`, `/notifications`, `/audit` | Admin views (admin role only) |
| PATCH / DELETE | `/api/admin/users/:id` (`action`: disable, enable, sign_out, unlock), `/api/admin/alerts/{price,stock}/:id` | Admin actions (audited) |
| POST | `/api/admin/listings/:id/check` | Check a listing now |

---

## 6. Database

Migrations live in `server/db/migrations` and are applied by `npm run migrate` (also on server
start when `DB_AUTO_MIGRATE=true`). Tables:

`retailers` · `products` · `product_listings` (one row per store listing/variant; price, stock,
last success/error, next check, lock) · `price_history` · `users` · `email_otps` (hashed codes,
pending registrations) · `user_sessions` (hashed session tokens) · `saved_products` ·
`price_alerts` · `stock_alerts` · `notification_logs` (unique `event_key` prevents duplicate
alert emails) · `admin_audit_logs` · `search_history`.

Unique keys prevent duplicate users, listings, saved products, alerts per user/product/store and
notification events.

---

## 7. Security

- Passwords hashed with **bcrypt** (12 rounds); OTPs stored only as HMAC-SHA256 hashes and compared in constant time.
- Sessions: random 256-bit token in an **httpOnly, SameSite=Lax** cookie (`Secure` in production); only its SHA-256 is stored.
- Requests that change data must come from the app's own origin (CSRF protection) — `CLIENT_ORIGIN`.
- Rate limits on login, OTP and alert endpoints (configurable `RATE_LIMIT_*`), per-account login lockout.
- Every user query is scoped by the session's user id; another user's alert id returns 404.
- All SQL uses parameterised queries. Store links are accepted only for amazon.in / flipkart.com /
  myntra.com, and **client-sent prices are never stored** — the server fetches prices itself.
- Helmet security headers; SMTP credentials and secrets live only in `server/.env`.

---

## 8. Data sources & limitations

Prices come from the public product and search pages of each store, fetched politely (spaced
requests, small batches, a capped number of browser pages). Store pages change and may block
automated access or show different content; when a page cannot be read reliably the app records
the check as **failed/unknown** rather than guessing, and keeps the last good data. Before using
this beyond personal/educational use, review each retailer's terms of service and robots policy.

**Approved data sources:** to switch a store to an official API or affiliate feed (e.g. Amazon
Product Advertising API, Flipkart Affiliate API), implement `search(query)` and
`extractFromUrl(url)` in a new class extending `server/adapters/baseAdapter.js` and register it in
`server/adapters/index.js`. The monitor, history and alerts use the adapter interface only, so
nothing else needs to change.

---

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| `MySQL not available` / `ECONNREFUSED` | Start MySQL (XAMPP → Start), check `DB_HOST`/`DB_PORT` in `server/.env`. |
| `ER_ACCESS_DENIED_ERROR` | Wrong `DB_USER` / `DB_PASSWORD`. |
| Accounts page says database not connected | Same as above; the server retries the database every 30 s. |
| OTP email not arriving | Check spam; run `npm run check:email --prefix server`; `SMTP_PASS` must be a Gmail App Password. |
| `Executable doesn't exist … chromium` | Run `npm run browsers --prefix server`. |
| `Port 5000 is already in use` | Stop the other process or set `PORT` in `server/.env` (and the proxy target in `client/vite.config.js`). |
| Codes stop working after restart | Set a fixed `OTP_SECRET` in `server/.env` (setup does this). |

## Project structure

```
├── package.json            root scripts: setup, dev:server, dev:client, migrate, test, build
├── docker-compose.yml      optional MySQL for development
├── scripts/setup.js        one-command setup for a new PC
├── database/schema.sql     full schema for phpMyAdmin import
├── client/                 React app (pages: Home, Search, Product, Login, Register,
│                           ForgotPassword, Dashboard, Watchlist)
└── server/
    ├── adapters/           Amazon India, Flipkart, Myntra (+ base adapter)
    ├── config/             env config, MySQL pool
    ├── controllers/        products, auth, account (saved/alerts/notifications)
    ├── db/                 migrate.js + migrations/
    ├── jobs/               scheduler (cron) and monitor:once
    ├── middleware/         auth/session, CSRF origin check, rate limits, validation
    ├── services/           auth, otp, email (mailer + templates), notifications, catalog,
    │                       price history, alerts, monitor, comparison, search
    ├── test/               unit + integration tests
    └── .env.example        every setting, documented
```
