// src/SecurityPage.tsx
//
// Self-contained security verification page.
// All crypto runs in the browser via Web Crypto API.
// No network requests are made on this page.

import { useState, useCallback } from "react";
import "./App.css";
import "./SecurityPage.css";

// ─── Inline crypto (copy of src/lib/crypto.ts core, visible to user) ──────────

function base64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const binary = atob(padded);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return view as Uint8Array<ArrayBuffer>;
}

async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

async function exportKeyBase64url(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return base64urlEncode(raw as ArrayBuffer);
}

interface DemoPayload {
  v: 1;
  alg: "AES-GCM";
  iv: string;
  data: string;
}

async function demoEncrypt(
  plaintext: string,
  key: CryptoKey
): Promise<DemoPayload> {
  const ivBuf = new ArrayBuffer(12);
  crypto.getRandomValues(new Uint8Array(ivBuf));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    enc.encode(plaintext)
  );
  return {
    v: 1,
    alg: "AES-GCM",
    iv: base64urlEncode(ivBuf),
    data: base64urlEncode(ciphertext as ArrayBuffer),
  };
}

async function demoDecrypt(
  payload: DemoPayload,
  key: CryptoKey
): Promise<string> {
  const iv = base64urlDecode(payload.iv);
  const data = base64urlDecode(payload.data);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    data.buffer as ArrayBuffer
  );
  return new TextDecoder().decode(plain);
}

// ─── Component ────────────────────────────────────────────────────────────────

type DemoState = "idle" | "encrypted" | "decrypted" | "error";

export default function SecurityPage() {
  const [input, setInput] = useState("Type something secret here...");
  const [keyB64, setKeyB64] = useState("");
  const [payload, setPayload] = useState<DemoPayload | null>(null);
  const [decrypted, setDecrypted] = useState("");
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [currentKey, setCurrentKey] = useState<CryptoKey | null>(null);

  const handleEncrypt = useCallback(async () => {
    try {
      const key = await generateKey();
      const encoded = await exportKeyBase64url(key);
      const result = await demoEncrypt(input, key);
      setKeyB64(encoded);
      setPayload(result);
      setCurrentKey(key);
      setDecrypted("");
      setDemoState("encrypted");
      setErrorMsg("");
    } catch (e) {
      setErrorMsg(String(e));
      setDemoState("error");
    }
  }, [input]);

  const handleDecrypt = useCallback(async () => {
    if (!payload || !currentKey) return;
    try {
      const result = await demoDecrypt(payload, currentKey);
      setDecrypted(result);
      setDemoState("decrypted");
      setErrorMsg("");
    } catch {
      setErrorMsg("GCM authentication failed — ciphertext has been tampered with");
      setDemoState("error");
    }
  }, [payload, currentKey]);

  const handleTamper = useCallback(() => {
    if (!payload) return;
    const data = payload.data;
    const tampered = data.slice(0, -4) + (data.endsWith("AAAA") ? "ZZZZ" : "AAAA");
    setPayload({ ...payload, data: tampered });
    setDecrypted("");
    setDemoState("encrypted");
  }, [payload]);

  return (
    <div className="secPage">
      <div className="secContent">

        {/* Header */}
        <header className="secHeader">
          <a href="/" className="secBack">← Back to app</a>
          <div className="eyebrow">Security</div>
          <h1>Verify it yourself</h1>
          <p className="secLead">
            burnafterread is end-to-end encrypted. This page shows exactly how —
            with live code running in your browser. No network requests are made here.
            Open DevTools → Network tab to confirm.
          </p>
        </header>

        {/* How it works */}
        <section className="secSection">
          <h2>How the encryption works</h2>

          <div className="secSteps">
            <div className="secStep">
              <span className="secStepNum">1</span>
              <div>
                <strong>Key generation</strong>
                <p>A 256-bit random key is generated in your browser using <code>crypto.subtle.generateKey</code>. It never leaves your device.</p>
              </div>
            </div>
            <div className="secStep">
              <span className="secStepNum">2</span>
              <div>
                <strong>Encryption</strong>
                <p>Your text is encrypted with <strong>AES-GCM 256</strong> using a random 12-byte IV. GCM provides both confidentiality and authenticity — tampered ciphertext cannot be decrypted.</p>
              </div>
            </div>
            <div className="secStep">
              <span className="secStepNum">3</span>
              <div>
                <strong>Upload</strong>
                <p>Only the ciphertext is sent to the server. The key stays in your browser and is appended to the share link as a <strong>URL fragment</strong> (<code>#k=…</code>).</p>
              </div>
            </div>
            <div className="secStep">
              <span className="secStepNum">4</span>
              <div>
                <strong>Why the server never sees the key</strong>
                <p>URL fragments are never sent in HTTP requests — this is defined in <a href="https://www.rfc-editor.org/rfc/rfc9110#section-4.2.3" target="_blank" rel="noreferrer">RFC 9110 §4.2.3</a>. Open DevTools → Network, open a drop link, and confirm: the <code>#k=…</code> part is absent from every request.</p>
              </div>
            </div>
            <div className="secStep">
              <span className="secStepNum">5</span>
              <div>
                <strong>Self-destruct</strong>
                <p>After the allowed number of views, both the D1 metadata record and the R2 blob are permanently deleted. The server cannot serve what it no longer has.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Live demo */}
        <section className="secSection">
          <h2>Live encryption demo</h2>
          <p className="secSectionLead">
            This demo runs entirely in your browser. The code is on this page — view source or open DevTools → Sources.
          </p>

          <div className="demoCard">
            <label className="fieldLabel">Plaintext</label>
            <textarea
              className="textarea"
              rows={3}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setDemoState("idle");
                setPayload(null);
                setKeyB64("");
                setDecrypted("");
              }}
            />

            <div className="demoActions">
              <button onClick={handleEncrypt}>
                🔐 Encrypt in browser
              </button>
              {payload && (
                <>
                  <button className="secondaryButton" onClick={handleTamper}>
                    ✂️ Tamper with ciphertext
                  </button>
                  <button className="secondaryButton" onClick={handleDecrypt}>
                    🔓 Decrypt
                  </button>
                </>
              )}
            </div>

            {demoState !== "idle" && (
              <div className="demoResults">
                {keyB64 && (
                  <div className="demoField">
                    <span className="demoLabel">AES-256 key (Base64url, 32 bytes)</span>
                    <span className="demoNote">This is the value after <code>#k=</code> in the share URL. The server never sees this.</span>
                    <code className="demoCode demoKey">{keyB64}</code>
                  </div>
                )}

                {payload && (
                  <>
                    <div className="demoField">
                      <span className="demoLabel">IV (12 bytes, random per encryption)</span>
                      <code className="demoCode">{payload.iv}</code>
                    </div>
                    <div className="demoField">
                      <span className="demoLabel">Ciphertext + GCM auth tag (what the server stores)</span>
                      <span className="demoNote">Click "Tamper" above to flip the last 4 bytes and see GCM authentication reject it.</span>
                      <code className="demoCode demoBreak">{payload.data}</code>
                    </div>
                  </>
                )}

                {demoState === "decrypted" && (
                  <div className="demoField demoSuccess">
                    <span className="demoLabel">✓ Decrypted plaintext</span>
                    <code className="demoCode">{decrypted}</code>
                  </div>
                )}

                {demoState === "error" && (
                  <div className="demoField demoError">
                    <span className="demoLabel">✗ Authentication failed</span>
                    <span className="demoNote">{errorMsg}</span>
                    <span className="demoNote">GCM detected the tampered ciphertext and refused to decrypt. This means no one can read data that has been modified in transit or in storage.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* What the server sees */}
        <section className="secSection">
          <h2>What the server stores</h2>
          <div className="secTable">
            <div className="secTableRow secTableHeader">
              <span>Data</span>
              <span>Where</span>
              <span>Server can read?</span>
            </div>
            <div className="secTableRow">
              <span>Ciphertext</span>
              <span>Cloudflare R2</span>
              <span className="secNo">No — encrypted</span>
            </div>
            <div className="secTableRow">
              <span>Drop ID, TTL, view count</span>
              <span>Cloudflare D1</span>
              <span className="secNo">Metadata only</span>
            </div>
            <div className="secTableRow">
              <span>Decryption key</span>
              <span>URL fragment only</span>
              <span className="secNo">Never sent to server</span>
            </div>
            <div className="secTableRow">
              <span>Your plaintext</span>
              <span>Your browser only</span>
              <span className="secNo">Never leaves your device</span>
            </div>
          </div>
        </section>

        {/* Verify yourself */}
        <section className="secSection">
          <h2>Verify it yourself — step by step</h2>

          <div className="secVerifySteps">
            <div className="secVerifyStep">
              <h3>1. Confirm the key never leaves your browser</h3>
              <ol>
                <li>Open DevTools → Network tab</li>
                <li>Create a drop on the main page</li>
                <li>Open the share link</li>
                <li>Inspect every request — the <code>#k=…</code> fragment will be absent from all of them</li>
              </ol>
            </div>

            <div className="secVerifyStep">
              <h3>2. Decrypt from the terminal</h3>
              <p>Using the CLI, you can receive and decrypt a drop entirely locally:</p>
              <pre className="secCode">{`npm install -g burnafter

burnafter receive "https://burnafterread.casablanque.com/d/<id>#k=<key>"`}</pre>
            </div>

            <div className="secVerifyStep">
              <h3>3. Decrypt manually with Node.js</h3>
              <p>Fetch the raw ciphertext from the API and decrypt it yourself:</p>
              <pre className="secCode">{`const crypto = require("crypto");

const KEY_B64 = "<paste #k= value here>";
const PAYLOAD = <paste ciphertext JSON here>;

function b64url(s) {
  return Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/"), "base64");
}

const key  = b64url(KEY_B64);
const iv   = b64url(PAYLOAD.iv);
const raw  = b64url(PAYLOAD.data);
const data = raw.subarray(0, raw.length - 16);
const tag  = raw.subarray(raw.length - 16);

const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
d.setAuthTag(tag);
console.log(Buffer.concat([d.update(data), d.final()]).toString("utf8"));`}</pre>
            </div>

            <div className="secVerifyStep">
              <h3>4. Read the source code</h3>
              <p>The full source is open on GitHub. The crypto module is a good starting point:</p>
              <div className="secLinks">
                <a href="https://github.com/casablanque-code/burnafterread" target="_blank" rel="noreferrer">
                  github.com/casablanque-code/burnafterread
                </a>
                <a href="https://github.com/casablanque-code/burnafterread/blob/main/src/lib/crypto.ts" target="_blank" rel="noreferrer">
                  src/lib/crypto.ts — browser encryption
                </a>
                <a href="https://github.com/casablanque-code/burnafterread/blob/main/worker/durable/DropAccessCoordinator.ts" target="_blank" rel="noreferrer">
                  worker/durable/DropAccessCoordinator.ts — server-side access control
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Primitives */}
        <section className="secSection">
          <h2>Cryptographic primitives</h2>
          <div className="secPrimitives">
            <div className="secPrimitive">
              <span className="secPrimName">Algorithm</span>
              <span className="secPrimValue">AES-GCM</span>
            </div>
            <div className="secPrimitive">
              <span className="secPrimName">Key size</span>
              <span className="secPrimValue">256 bits</span>
            </div>
            <div className="secPrimitive">
              <span className="secPrimName">IV size</span>
              <span className="secPrimValue">96 bits (12 bytes), random per message</span>
            </div>
            <div className="secPrimitive">
              <span className="secPrimName">Auth tag</span>
              <span className="secPrimValue">128 bits (16 bytes), appended to ciphertext</span>
            </div>
            <div className="secPrimitive">
              <span className="secPrimName">Key encoding</span>
              <span className="secPrimValue">Base64url, no padding, URL fragment only</span>
            </div>
            <div className="secPrimitive">
              <span className="secPrimName">Implementation</span>
              <span className="secPrimValue">Web Crypto API (browser), node:crypto (CLI) — no third-party crypto libs</span>
            </div>
            <div className="secPrimitive">
              <span className="secPrimName">Delete token</span>
              <span className="secPrimValue">SHA-256 of random 32-byte token, constant-time comparison</span>
            </div>
          </div>
        </section>

        <footer className="secFooter">
          <a href="/">← Back to burnafterread</a>
        </footer>

      </div>
    </div>
  );
}
