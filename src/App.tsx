// src/App.tsx

import { useMemo, useState } from "react";
import "./App.css";
import {
  decodeKeyFromUrl,
  decryptBytes,
  decryptText,
  encodeKeyForUrl,
  encryptBytes,
  encryptText,
  generateKeyBytes,
  type EncryptedPayloadV1,
} from "./lib/crypto";

type Mode = "create" | "read";
type CreateKind = "text" | "file";

interface CreateResponse {
  id: string;
  delete_token: string;
}

interface ReadResponse {
  ciphertext: string;
  kind: "text" | "file";
}

interface FilePayloadV1 {
  v: 1;
  type: "file";
  filename: string;
  mime: string;
  iv: string;
  data: string;
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
  const [file, setFile] = useState<File | null>(null);

  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState("");
  const [deleteToken, setDeleteToken] = useState("");
  const [createError, setCreateError] = useState("");

  const [reading, setReading] = useState(false);
  const [readText, setReadText] = useState("");
  const [readError, setReadError] = useState("");
  const [readFileInfo, setReadFileInfo] = useState<string>("");

  async function handleCreate() {
    setCreateError("");
    setCreatedLink("");
    setDeleteToken("");

    if (!file && !text.trim()) {
      setCreateError("Enter some text or select a file.");
      return;
    }

    try {
      setCreating(true);

      const rawKey = generateKeyBytes();

      let ciphertext = "";
      let kind: CreateKind = "text";
      let sizeBytes = 0;

      if (file) {
        kind = "file";

        const buffer = await file.arrayBuffer();
        const encrypted = await encryptBytes(buffer, rawKey);

        const payload: FilePayloadV1 = {
          v: 1,
          type: "file",
          filename: file.name,
          mime: file.type || "application/octet-stream",
          iv: encrypted.iv,
          data: encrypted.data,
        };

        ciphertext = JSON.stringify(payload);
        sizeBytes = buffer.byteLength;
      } else {
        kind = "text";

        const encryptedPayload = await encryptText(text, rawKey);

        ciphertext = JSON.stringify({
          ...encryptedPayload,
          type: "text",
        });

        sizeBytes = new TextEncoder().encode(text).length;
      }

      const response = await fetch("/api/drops", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ciphertext,
          ttl_seconds: ttlSeconds,
          views,
          kind,
          size_bytes: sizeBytes,
          paranoid,
        }),
      });

      if (!response.ok) {
        const maybeError = await response.json().catch(() => null);
        throw new Error(maybeError?.message || maybeError?.error || "Failed to create drop");
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
    setReadFileInfo("");

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
        throw new Error(maybeError?.message || maybeError?.error || "Failed to read drop");
      }

      const data = (await response.json()) as ReadResponse;
      const payload = JSON.parse(data.ciphertext) as
        | (EncryptedPayloadV1 & { type?: "text" })
        | FilePayloadV1;

      const rawKey = decodeKeyFromUrl(fragmentKey);

      if (payload.type === "file") {
        const buffer = await decryptBytes(payload, rawKey);
        const blob = new Blob([buffer], {
          type: payload.mime || "application/octet-stream",
        });

        const fileUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = fileUrl;
        a.download = payload.filename || "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(fileUrl);

        setReadFileInfo(`Downloaded: ${payload.filename}`);
      } else {
        const plaintext = await decryptText(payload as EncryptedPayloadV1, rawKey);
        setReadText(plaintext);
      }
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

          {readFileInfo ? (
            <div className="resultBlock">
              <div className="resultLabel">File</div>
              <div>{readFileInfo}</div>
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
          Text and files are encrypted in your browser before upload. We can’t read them.
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
          disabled={!!file}
        />

        <label className="fieldLabel" htmlFor="fileInput" style={{ marginTop: 16 }}>
          File (optional, max 5 MB)
        </label>
        <input
          id="fileInput"
          type="file"
          onChange={(e) => {
            const selected = e.target.files?.[0] || null;

            if (!selected) {
              setFile(null);
              return;
            }

            if (selected.size > 5 * 1024 * 1024) {
              alert("Max file size is 5 MB");
              e.currentTarget.value = "";
              setFile(null);
              return;
            }

            setFile(selected);
            setText("");
          }}
        />

        {file ? (
          <div className="resultBlock" style={{ marginTop: 16 }}>
            <div className="resultLabel">Selected file</div>
            <div>{file.name}</div>
            <div className="muted" style={{ marginTop: 6 }}>
              {(file.size / 1024).toFixed(1)} KB
            </div>
            <div className="inlineButtons" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="secondaryButton"
                onClick={() => setFile(null)}
              >
                Remove file
              </button>
            </div>
          </div>
        ) : null}

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