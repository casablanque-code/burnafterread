# 🔐 BurnAfterRead

**Privacy-first, end-to-end encrypted, self-destructing data sharing.**

Share sensitive text or files via links that expire after being read. No accounts. No tracking. The server never sees your decryption key.

https://burnafterread.casablanque.com

---

## ✨ Features

- 🔐 **End-to-end encryption (AES-GCM 256)** — encrypted in your browser before upload
- 🔑 **Zero-knowledge architecture** — server never sees the decryption key
- 💣 **Burn after read** — data is destroyed after access
- 📁 **File support** — up to 5 MB
- ⏳ **TTL expiration** — 1 hour, 24 hours, or 7 days
- 🔁 **Limited views** — 1, 3, or 10 reads
- 🗑️ **Revoke anytime** — delete a drop before it's read using the delete token
- 🕶️ **Paranoid mode** — always deletes on first access, returns `not_found` instead of `expired`/`burned`
- 🧠 **Atomic reads** — Durable Objects prevent double-reads under concurrent requests
- 🚦 **Rate limiting** — 20 requests per IP per 60 seconds on all API routes
- ♻️ **Automatic cleanup** — expired drops purged from D1 and R2 every hour

---

## 🧠 How it works

```
plaintext → AES-GCM encrypt (browser) → ciphertext → Cloudflare R2
                    ↓
             key stays in URL fragment (#k=...)
             never sent to server
```

When someone opens the link:

```
URL fragment → key parsed locally → fetch ciphertext → decrypt in browser → plaintext
```

The URL looks like:

```
https://burnafterread.casablanque.com/d/<id>#k=<base64url-key>
```

`id` is sent to the server. `k` never leaves the browser — it's a URL fragment.

---

## 🏗️ Architecture

| Layer | Technology |
|---|---|
| Frontend | React, Web Crypto API |
| Backend | Cloudflare Workers |
| Metadata | Cloudflare D1 (SQLite) |
| Blobs | Cloudflare R2 |
| Concurrency | Durable Objects (`DropAccessCoordinator`) |
| Rate limiting | Durable Objects (`RateLimiter`, sliding window) |
| Cleanup | Workers Cron Trigger (hourly) |

---

## 🔁 Read lifecycle

1. `GET /api/drops/:id` hits the Worker
2. Worker checks rate limit (DO-based, per IP)
3. Worker delegates to `DropAccessCoordinator` DO
4. Inside `blockConcurrencyWhile` (atomic):
   - Check TTL
   - Check `views_left`
   - Decrement counter
   - Fetch ciphertext from R2
   - If paranoid or last view → delete D1 record + R2 object
5. Return ciphertext to browser
6. Browser decrypts with key from URL fragment

---

## 🗑️ Revoke lifecycle

1. Sender calls `DELETE /api/drops/:id` with `{ delete_token }`
2. Worker delegates to `DropAccessCoordinator` DO
3. Inside `blockConcurrencyWhile`:
   - Fetch drop from D1
   - Hash provided token, compare with stored hash (constant-time)
   - Delete D1 record + R2 object
4. Link is immediately dead

---

## 🚀 Local development

```bash
npm install

# create local D1
npx wrangler d1 execute burnafterread-db --local --file=./migrations/0001_init.sql

# build frontend + start worker
npm run build
npx wrangler dev
```

Open `http://localhost:8787`

---

## 🧪 API

### Create drop

```http
POST /api/drops
Content-Type: application/json

{
  "ciphertext": "<encrypted payload as JSON string>",
  "ttl_seconds": 86400,
  "views": 1,
  "kind": "text",
  "size_bytes": 123,
  "paranoid": true
}
```

Response:

```json
{
  "id": "AbCdEf1234",
  "delete_token": "<base64url token>"
}
```

---

### Read drop

```http
GET /api/drops/:id
```

Response:

```json
{
  "ciphertext": "<encrypted payload>",
  "kind": "text"
}
```

Errors: `404 not_found`, `410 expired`, `410 burned`, `429 too many requests`

---

### Revoke drop

```http
DELETE /api/drops/:id
Content-Type: application/json

{
  "delete_token": "<token from create response>"
}
```

Response: `{ "ok": true }`

---

## 🧰 CLI

Send and receive drops directly from your terminal. Same zero-knowledge guarantees as the web app.

### Install

```bash
npm install -g burnafter
```

### Send

```bash
# send a file
burnafter send secret.txt

# send text inline
burnafter send --text "my api key"

# custom TTL and views
burnafter send config.env --ttl 3600 --views 1

# paranoid mode
burnafter send archive.zip --paranoid
```

Options:

| Flag | Description | Default |
|---|---|---|
| `--text <text>` | Send text instead of file | — |
| `--ttl <seconds>` | Time to live | `86400` |
| `--views <n>` | Allowed reads | `1` |
| `--paranoid` | Delete on first access | `false` |

### Receive

```bash
# decrypt text to stdout
burnafter receive "https://burnafterread.casablanque.com/d/AbCdEf1234#k=..."

# save to specific file
burnafter receive "https://...#k=..." --out secret.env
```

The URL must be passed as a quoted string to prevent the shell from stripping the `#` fragment.

---

## ⚠️ Security notes

- Encryption is **client-side only** — the server stores ciphertext, never plaintext
- The decryption key is in the **URL fragment** — it is never sent to the server by the browser
- **No authentication** — the link itself is the only access control; guard it accordingly
- **Losing the link means losing the data** — there is no recovery mechanism
- `ttl_seconds` is bounded to 60s–7 days; `views` to 1–10
- All API responses include `Content-Security-Policy`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`

---

## 📜 License

MIT
