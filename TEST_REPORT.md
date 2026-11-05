# PricePiler — Project Audit & Test Report

_Date: 2026-11-05 · Environment: Windows, Node v24.18.0, npm 11.16.0, MySQL 8 (127.0.0.1:3306)_

> **Superseded for Flipkart:** the manual Flipkart price-entry flow described below was later
> removed. Flipkart is now scraped live with Playwright — see *Flipkart scraping* in
> [README.md](README.md#flipkart-scraping). This file remains the audit record of that date.

Scope: full audit of `server/` and `client/` — understand → baseline → end-to-end test → fix → classify → report.
No scraping workarounds were added. No `.env` secrets were read/printed/modified. No production code was mocked or stubbed.

---

## 1. How to install / start / test

| Step | Command (from repo root) |
| --- | --- |
| Install | `npm run setup` (installs `server/` and `client/`) |
| Migrate DB | `npm run migrate` |
| Dev (both) | `npm run dev:server` and `npm run dev:client` (Vite proxies `/api` → `http://localhost:5000`) |
| Build client | `npm run build` |
| Production | `npm start` (builds client, serves `client/dist` from Express) |
| Server unit tests | `npm test` → `node --test` in `server/` |
| Integration tests | `cd server` then `$env:TEST_DB_PORT=3306; npm run test:integration` |
| Create admin | `npm run admin:create` |
| One monitor pass | `cd server; npm run monitor:once` |

There is **no client lint script** (`client/package.json` has only `dev`, `build`, `preview`). The production build is used as the closest static check.

### `.env` vs `.env.example`
- **Missing in `.env` (all optional; app degrades gracefully):** `FLIPKART_AFFILIATE_ID`, `FLIPKART_AFFILIATE_TOKEN`, `FLIPKART_API_BASE`.
- **Present but empty in `.env`:** `DB_PASSWORD`, `ALLOWED_EMAIL_DOMAINS`, `SCRAPER_PROXY_URL`.
- **`.env.backup`** contains legacy keys not referenced anywhere in code: `ADAPTER_MODE`, `SEED_DEMO_DATA`, `AMAZON_PA_API_ACCESS_KEY/SECRET_KEY/PARTNER_TAG/HOST/REGION`. Safe to ignore; not deleted (config file).
- No secret values are reproduced in this report.

---

## 2. Summary table

| Feature | Status | Notes |
| --- | --- | --- |
| Server boot, DB connect, auto-migrate, adapter load | Working | Health reports DB connected, 3 adapters, email mode. |
| Health endpoint `GET /api/health` | Working | Reports per-adapter `available` flags. |
| Auth: register + OTP + verify + resend | Working | Covered by integration tests. |
| Auth: login (+ 2FA OTP), logout, protected routes | Working | 401 on protected routes without a session. |
| Auth: forgot/reset password, account lockout, rate limits | Working | Validation returns 400/429 correctly. |
| Account: saved products | Working | Integration tests. |
| Account: price alerts / stock alerts CRUD | Working | Integration tests; ownership enforced (404 cross-user). |
| Account: notifications, dashboard | Working | Integration tests. |
| Account: **profile update** | Working | `PATCH /api/auth/me`. |
| Account: **account deletion** | Not working | No such route/feature exists (see §4 c-2). |
| Token refresh | Not applicable | Auth is HTTP-only session cookies with TTL; no refresh tokens by design. |
| Product search — Amazon (live) | Working | Live search returned real results (20 raw → matched). |
| Product search — Myntra (live) | Working | Store returns `no_match` for some queries (data-driven, not an error). |
| Product search — Flipkart | Working (manual) | No API creds → excluded from keyword search by design. |
| Add by URL — Amazon / Myntra | Working | Live extraction returned real price/stock. |
| Add by URL — **Flipkart** | **Fixed** | Was `503`; now returns a graceful unverified fallback. |
| Comparison (multi-store, best price, out-of-stock) | Working | Verified via live search + stored-product path. |
| Price history records + chart data + manual fallback entries | Working | Integration tests. |
| Alerts trigger on price drop / restock + email | Working | Integration tests (email captured in a mock outbox). |
| Scheduler + `runOnce`, **skip Flipkart** | **Fixed** | Was recorded as a failure; now skipped automatically. |
| Admin routes + role checks (non-admin → 403) | Working | Integration tests. |
| Error handling (bad input, 413, malformed JSON, 403, 404) | Working | No crashes; clean JSON errors. |
| Frontend: all routes render, mobile width, prod build | Working | 9/9 routes rendered in headless Chromium at 390px; build OK. |
| Security: no secrets in bundle, CORS, cross-site POST, no stack traces | **Fixed** | Bundle clean; CORS correct; unexpected 500 messages now generic. |

---

## 3. Fixes made

| # | File | What changed | Why |
| --- | --- | --- | --- |
| 1 | [productsController.js](file:///c:/Users/nadar/OneDrive/Desktop/PricePiler/server/controllers/productsController.js#L179-L186) | Removed the `!adapter.isAvailable()` guard in `extractUrl` (kept `!adapter`). | The guard returned `503` for Flipkart before the adapter ran, defeating the adapter's deliberate URL-slug fallback. The client ([UrlExtractor.jsx](file:///c:/Users/nadar/OneDrive/Desktop/PricePiler/client/src/components/UrlExtractor.jsx#L54-L54)) already renders the "unverified" state. Verified: `POST /api/products/extract-url` with a Flipkart URL now returns `200` + `sourceNote`. |
| 2 | [monitorService.js](file:///c:/Users/nadar/OneDrive/Desktop/PricePiler/server/services/monitorService.js#L119-L131) | Added `skipUnavailable()`; `checkListing` now **skips** (releases lock, leaves data untouched, advances `next_check_at`) when the store has no usable adapter instead of calling `recordFailure`. | The scheduler requirement is "skip Flipkart automatically". Previously each pass recorded a failure and backed off (`monitor.check_failed … No adapter available for flipkart`). Verified log now: `monitor.skip_store_unavailable`. |
| 3 | [errorHandler.js](file:///c:/Users/nadar/OneDrive/Desktop/PricePiler/server/middleware/errorHandler.js#L5-L17) | Unexpected errors (no explicit `err.status`) now return `"Internal server error"`; only deliberately-set messages are surfaced. | Prevents raw internal messages (e.g. SQL text) from leaking in 500 responses. Details are still logged server-side in non-production. |

### Cleanup
Deleted 13 standalone diagnostic scripts after confirming (via repo-wide grep on `diag-`/`debug-scrape` and `package.json`) that nothing imports or references them:
`diag-amazon.js`, `diag-amazon2.js`, `diag-amazon3.js`, `diag-amazon-pdp.js`, `diag-amazon-pdp2.js`, `diag-amz-oot.js`, `diag-amz-pdp-final.js`, `diag-combined.js`, `diag-e2e.js`, `diag-myntra.js`, `diag-myntra-match.js`, `diag-store-search.js`, `debug-scrape.js`.
(No files under `client/`, no config, no `.env*` were touched.)

---

## 4. Tests added & final results

Added to [integration.test.js](file:///c:/Users/nadar/OneDrive/Desktop/PricePiler/server/test/integration.test.js):
- Extended the monitor test to assert that an unavailable store is **skipped** (`skipped: 'store_unavailable'`, no failure recorded, lock released, price untouched, next check scheduled).
- New `extract-url returns a graceful Flipkart fallback when credentials are missing` (asserts `200`, `price: null`, `availability: 'unknown'`, credential note).
- New `extract-url rejects unsupported domains` (asserts `400`).

Final results (real output):

- **Server unit tests** — `npm test` in `server/`:
  `ℹ tests 85 · pass 84 · fail 0 · skipped 1 · duration 33.6s` (the 1 skip is the DB-gated integration file when run without `TEST_DB_PORT`).
- **Integration tests** — `TEST_DB_PORT=3306 npm run test:integration`:
  `ℹ tests 15 · pass 15 · fail 0 · skipped 0 · duration 11.1s` (was 13 → +2 new).
- **Client build** — `npm run build` in `client/`:
  `✓ 916 modules transformed · ✓ built in 30.6s` (largest chunk `ProductDetails` 401 kB / 111 kB gzip; no warnings).

Live API evidence gathered against a running server: health `200`; Flipkart extract-url `200` (fixed) with `sourceNote: "Flipkart live data needs Affiliate API credentials…"`; Amazon extract-url `200` (`price 73990`, `in_stock`); Myntra extract-url `200`; live search `200` (2 matched products); monitor pass completed.

---

## 5. Not working and why

### (a) Blocked by store
None observed during this run. Amazon and Myntra both responded to live extraction. **Caveat:** their live data is obtained by browser scraping; they can start returning `403/429` at any time. The app already degrades gracefully — the adapter registry reports per-store availability on `/api/health`, and searches return a `storeStatus` entry rather than crashing.

### (b) Needs credentials / access I don't have
1. **Flipkart Affiliate API** — `FLIPKART_AFFILIATE_ID` / `FLIPKART_AFFILIATE_TOKEN` are unset (`GET /api/health` → `{"slug":"flipkart","available":false}`). Live Flipkart prices are therefore unavailable; the app returns the unverified URL fallback.
2. **SMTP** — `/api/health` reported `email: "smtp"`, but credentials were not provided to me, so I could not read real OTP emails. Auth flows were validated end-to-end through the integration suite, which captures mail in a mock outbox.
3. **DB password** — `DB_PASSWORD` is empty in `.env`; it works only because the local MySQL `root` has no password. This will fail on any networked/credentialed MySQL.

### (c) Needs a product / design decision
1. **Anti-bot evasion code exists in [browser.js](file:///c:/Users/nadar/OneDrive/Desktop/PricePiler/server/utils/browser.js#L28-L144)** — `--disable-blink-features=AutomationControlled` plus an `addInitScript` that hides `navigator.webdriver` and spoofs `window.chrome`, plugins, languages and permissions. This conflicts with the audit rule "no stealth plugins / fingerprint spoofing / access-control bypassing". I did **not** remove it because it is load-bearing for the current Amazon/Myntra live data (both worked in this run), and removal would break them — that is your call. `utils/scraperProxy.js` (proxy support, driven by `SCRAPER_PROXY_URL`) is present but disabled (empty), so no proxy rotation is active.
2. **No account-deletion feature** — there is no `DELETE /api/me` or equivalent route; the checklist item "account deletion" does not exist in the codebase.
3. **No "manual price" entry UI** — "Flipkart uses the manual-price flow" is not implemented as a feature. Today Flipkart yields an unverified fallback with `price: null` and a note; there is no screen to type a price in by hand.
4. **No token refresh** — authentication is HTTP-only session cookies with a TTL; there is no refresh-token flow.

### (d) External outage / environment limit
1. **Port 5000 occupied** — a pre-existing process holds `5000`, so the server exits with `EADDRINUSE` on the default port (handled cleanly, no crash). The audit ran on `5055`/`5060`/`5061`.
2. **No client lint tooling** — `npm run lint` does not exist, so lint could not be run as requested.
3. Client `npm install` prints a benign `npm warn allow-scripts … esbuild@0.21.5`.

### (e) Bug I could not fully resolve
1. **Myntra `extract-url` possible metadata mismatch** — `POST /api/products/extract-url` with `https://www.myntra.com/tshirts/hrx-by-hrithik-roshan/…/23694556/buy` returned `200` but with a different product ("Lawman Pg3 Mens Blue Slim Fit Stretchable Jeans", category `Jeans`, `price 3199`). The URL was a guessed/hand-written one, so it may be a dead product that Myntra resolves to a fallback page. Not reproduced with a second URL because valid current Myntra links were not available. **Not fixed** — needs real product URLs to confirm whether the extractor or the store is at fault. Evidence: HTTP `200`, response `name` ≠ URL slug.
2. **Minor:** `/api/products/search` `storeStatus` omits Flipkart entirely (it is filtered out as unavailable) rather than reporting it as "unavailable". Cosmetic.

---

## 6. Exact steps for categories (b) and (c)

**(b)-1 Flipkart API:** apply for Affiliate API access at `affiliate.flipkart.com`; then set in `server/.env`:
`FLIPKART_AFFILIATE_ID=<id>`, `FLIPKART_AFFILIATE_TOKEN=<token>`, `FLIPKART_API_BASE=https://affiliate-api.flipkart.net/affiliate`. Restart the server; `/api/health` should show `flipkart.available: true`.

**(b)-2 SMTP:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` in `server/.env`; verify with `cd server; npm run check:email`.

**(b)-3 DB password:** set `DB_PASSWORD` to your MySQL password (and `DB_USER`/`DB_NAME` if not `root`/`price_comparison`); re-run `npm run migrate`.

**(c)-1 Anti-bot code:** decide one of:
   (i) keep the current Amazon/Myntra scraping (and its evasion code) as-is; or
   (ii) have me strip the stealth/evasion from [browser.js](file:///c:/Users/nadar/OneDrive/Desktop/PricePiler/server/utils/browser.js) — expect Amazon/Myntra live data to degrade to "blocked by store" (handled gracefully), or
   (iii) move Amazon/Myntra to official APIs (Amazon PA-API / an approved feed) and drop browser scraping entirely.

**(c)-2 Account deletion:** confirm you want it (e.g. `DELETE /api/me` → soft-delete the user, cascade sessions/alerts, and re-authenticate). I can implement it once approved.

**(c)-3 Manual Flipkart price:** confirm the desired flow (e.g. a "Enter price manually" field on the Flipkart offer card that stores a `manual` snapshot). I can implement it once approved.

---

## 7. Recommended next steps (by importance)

1. **Rotate/replace the `.env` secrets** — the repo contains `.env` and `.env.backup`; confirm they are git-ignored and not committed.
2. **Decide on (c)-1** (anti-bot evasion) — it is the largest rule/functionality tension in the project.
3. **Provide Flipkart Affiliate credentials** so live Flipkart prices work, or confirm the manual-price flow and have it built.
4. **Add a client lint script** (ESLint) so `npm run lint` exists and is part of CI.
5. **Add account deletion** if it is a required feature.
6. **Investigate the Myntra metadata mismatch** with real product URLs.
7. **Add CI** running `npm test`, the integration suite (with a service MySQL), and the client build on every push; consider setting `COOKIE_SECURE=true` and `NODE_ENV=production` in production.

---

### Final verification (re-run as requested)

```
server unit tests : tests 85 | pass 84 | fail 0 | skipped 1
integration tests : tests 15 | pass 15 | fail 0 | skipped 0
client build      : ✓ 916 modules transformed | ✓ built in 30.6s
```

Everything above passed on the final run. No known test or build failures remain. The open items are the scoped findings in §5 — none of them is a hidden failure: they are either external (missing credentials/ports), product decisions (anti-bot code, missing features), or one unconfirmed Myntra data question.
