// src/App.tsx

import { useMemo, useState } from "react";
import "./App.css";
import {
  decodeKeyFromUrl,
  decryptText,
  encodeKeyForUrl,
  encryptText,
  generateKeyBytes,
  type EncryptedPayloadV1,
} from "./lib/crypto";

type Mode = "create" | "read";

interface CreateResponse {
  id: string;
  delete_token: string;
}

interface ReadResponse {
  ciphertext: string;
  kind: "text" | "file";
}

function getModeFromLocation(pathname: string): Mode {
  return pathname.startsWith("/d/") ? "read" : "create";
}

function getDropIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "d") {
    return parts[1];
  }
  return null;
}

function getKeyFromHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;

  const fragment = hash.slice(1);
  const params = new URLSearchParams(fragment);
  return params.get("k");
}

function App() {
  const mode = useMemo(() => getModeFromLocation(window.location.pathname), []);
  const dropId = useMemo(() => getDropIdFromPath(window.location.pathname), []);
  const fragmentKey = useMemo(() => getKeyFromHash(window.location.hash), []);

  const [text, setText] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState(86400);
  const [views, setViews] = useState(1);
  const [paranoid, setParanoid] = useState(true);

  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState("");
  const [deleteToken, setDeleteToken] = useState("");
  const [createError, setCreateError] = useState("");

  const [reading, setReading] = useState(false);
  const [readText, setReadText] = useState("");
  const [readError, setReadError] = useState("");

  async function handleCreate() {
    setCreateError("");
    setCreatedLink("");
    setDeleteToken("");

    if (!text.trim()) {
      setCreateError("Enter some text first.");
      return;
    }

    try {
      setCreating(true);

      const rawKey = generateKeyBytes();
      const encryptedPayload = await encryptText(text, rawKey);
      const ciphertext = JSON.stringify(encryptedPayload);

      const response = await fetch("/api/drops", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ciphertext,
          ttl_seconds: ttlSeconds,
          views,
          kind: "text",
          size_bytes: new TextEncoder().encode(text).length,
          paranoid,
        }),
      });

      if (!response.ok) {
        const maybeError = await response.json().catch(() => null);
        throw new Error(maybeError?.error || "Failed to create drop");
      }

      const data = (await response.json()) as CreateResponse;
      const encodedKey = encodeKeyForUrl(rawKey);

      const link = `${window.location.origin}/d/${data.id}#k=${encodedKey}`;

      setCreatedLink(link);
      setDeleteToken(data.delete_token);

      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // ignore clipboard errors
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  async function handleRead() {
    setReadError("");
    setReadText("");

    if (!dropId) {
      setReadError("Missing drop id.");
      return;
    }

    if (!fragmentKey) {
      setReadError("Missing key in URL fragment.");
      return;
    }

    try {
      setReading(true);

      const response = await fetch(`/api/drops/${dropId}`, {
        method: "GET",
        headers: {
          "cache-control": "no-store",
        },
      });

      if (!response.ok) {
        const maybeError = await response.json().catch(() => null);
        throw new Error(maybeError?.error || "Failed to read drop");
      }

      const data = (await response.json()) as ReadResponse;
      const payload = JSON.parse(data.ciphertext) as EncryptedPayloadV1;
      const rawKey = decodeKeyFromUrl(fragmentKey);
      const plaintext = await decryptText(payload, rawKey);

      setReadText(plaintext);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setReading(false);
    }
  }

  if (mode === "read") {
    return (
      <main className="page">
        <section className="card">
          <div className="eyebrow">BurnAfterRead</div>
          <h1>Read secure drop</h1>
          <p className="muted">
            The server never receives the decryption key. It stays in the URL fragment.
          </p>

          <div className="meta">
            <div>
              <span className="metaLabel">Drop ID</span>
              <code>{dropId ?? "missing"}</code>
            </div>
            <div>
              <span className="metaLabel">Key in URL</span>
              <code>{fragmentKey ? "present" : "missing"}</code>
            </div>
          </div>

          <div className="actions">
            <button onClick={handleRead} disabled={reading}>
              {reading ? "Decrypting..." : "Open and decrypt"}
            </button>
          </div>

          {readError ? <div className="error">{readError}</div> : null}

          {readText ? (
            <div className="resultBlock">
              <div className="resultLabel">Decrypted message</div>
              <pre className="plaintextBox">{readText}</pre>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="card">
        <div className="eyebrow">BurnAfterRead</div>
        <h1>Create secure drop</h1>
        <p className="muted">
          Text is encrypted in your browser before upload. We can’t read it.
        </p>

        <label className="fieldLabel" htmlFor="secretText">
          Secret text
        </label>
        <textarea
          id="secretText"
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a password, config, token, note, or anything sensitive..."
          rows={10}
        />

        <div className="grid">
          <div className="field">
            <label className="fieldLabel" htmlFor="ttl">
              TTL
            </label>
            <select
              id="ttl"
              className="select"
              value={ttlSeconds}
              onChange={(e) => setTtlSeconds(Number(e.target.value))}
            >
              <option value={3600}>1 hour</option>
              <option value={86400}>24 hours</option>
              <option value={604800}>7 days</option>
            </select>
          </div>

          <div className="field">
            <label className="fieldLabel" htmlFor="views">
              Views
            </label>
            <select
              id="views"
              className="select"
              value={views}
              onChange={(e) => setViews(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={10}>10</option>
            </select>
          </div>
        </div>

        <label className="toggleRow">
          <input
            type="checkbox"
            checked={paranoid}
            onChange={(e) => setParanoid(e.target.checked)}
          />
          <span>Paranoid mode</span>
        </label>

        <div className="actions">
          <button onClick={handleCreate} disabled={creating}>
            {creating ? "Encrypting..." : "Create secure link"}
          </button>
        </div>

        {createError ? <div className="error">{createError}</div> : null}

        {createdLink ? (
          <div className="resultBlock">
            <div className="resultLabel">Secure link</div>
            <textarea className="linkBox" readOnly value={createdLink} rows={3} />

            <div className="inlineButtons">
              <button
                type="button"
                className="secondaryButton"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(createdLink);
                  } catch {
                    // ignore
                  }
                }}
              >
                Copy link
              </button>

              <button
                type="button"
                className="secondaryButton"
                onClick={() => {
                  window.open(createdLink, "_blank", "noopener,noreferrer");
                }}
              >
                Open link
              </button>
            </div>

            <div className="resultLabel">Delete token</div>
            <textarea className="linkBox" readOnly value={deleteToken} rows={2} />
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default App;