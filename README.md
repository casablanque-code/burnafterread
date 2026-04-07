# 🔐 BurnAfterRead

**Privacy-first, end-to-end encrypted, self-destructing data sharing.**

BurnAfterRead lets you securely share sensitive data (text for now) using links that **expire after being read**.

No accounts. No tracking. No server-side access to your secrets.

---

## ✨ Features

* 🔐 **End-to-end encryption (AES-GCM)** — data is encrypted in your browser
* 🔑 **Zero-knowledge architecture** — server never sees the decryption key
* 💣 **Burn after read** — data is destroyed after access
* ⏳ **Time-based expiration (TTL)**
* 🔁 **Limited views**
* 🧠 **Atomic reads via Durable Objects**
* 🕶️ **Paranoid mode** — minimal metadata, no logs

---

## 🧠 How it works

### Encryption flow

```text
plaintext → (browser) → encrypt → ciphertext → server
```

### Decryption flow

```text
ciphertext → (browser + key from URL) → decrypt → plaintext
```

### Key detail

```text
https://app/d/<id>#k=<secret-key>
```

* `id` → sent to server
* `key` → stays in browser (URL fragment, never sent)

👉 The server **cannot decrypt your data**, even if compromised.

---

## 🏗️ Architecture

* **Frontend:** React + Web Crypto API
* **Backend:** Cloudflare Workers
* **Storage:**

  * D1 → metadata
  * R2 → encrypted blobs
* **Concurrency control:** Durable Objects

---

## 🔁 Read lifecycle

1. Client requests `/api/drops/:id`
2. Worker delegates to Durable Object
3. Durable Object:

   * checks TTL
   * checks remaining views
   * decrements counter atomically
4. If last read → deletes:

   * D1 record
   * R2 object
5. Returns ciphertext

---

## 🚀 Local development

### 1. Install

```bash
npm install
```

---

### 2. Run database migration

```bash
npx wrangler d1 execute burnafterread-db --local --file=./migrations/0001_init.sql
```

---

### 3. Build frontend

```bash
npm run build
```

---

### 4. Start dev server

```bash
npx wrangler dev
```

Open:

```text
http://localhost:8787
```

---

## 🧪 API

### Create drop

```http
POST /api/drops
```

Body:

```json
{
  "ciphertext": "...",
  "ttl_seconds": 86400,
  "views": 1,
  "kind": "text",
  "size_bytes": 123,
  "paranoid": true
}
```

---

### Read drop

```http
GET /api/drops/:id
```

---

## ⚠️ Security notes

* Encryption happens **only on the client**
* The server stores **ciphertext only**
* Decryption key is never transmitted
* No authentication → links are the only access control
* If you lose the link → data is gone forever

---

## 🧭 Roadmap

* [ ] File support (up to 5MB)
* [ ] CLI tool (`burnafter`)
* [ ] QR sharing
* [ ] Dead-man switch
* [ ] Multi-part secrets

---

## 📜 License

MIT

---

## 💡 Philosophy

> Built by a human, for humans.
> No tracking. No data harvesting. No bullshit.
