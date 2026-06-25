#!/usr/bin/env node

import { Command } from "commander";
import fs from "fs";
import fetch from "node-fetch";
import { generateKey, encryptBytes, encodeKey, decryptBytes, decodeKey } from "./crypto.js";

const API_URL = "https://burnafterread.casablanque.workers.dev";

const program = new Command();

program
  .name("burnafter")
  .description("🔐 Secure burn-after-read sharing (E2E encrypted)")
  .version("1.0.0")
  .addHelpText(
    "after",
    `
Examples:

  burnafter send secret.txt
  burnafter send --text "my secret"
  burnafter send config.env --ttl 3600 --views 1
  burnafter send file.zip --paranoid

  burnafter receive "https://burnafterread.casablanque.workers.dev/d/AbCdEf1234#k=..."
  burnafter receive "https://..." --out decrypted.bin

Notes:

  - Data is encrypted locally before upload
  - The server never sees your decryption key
  - Links self-destruct after being opened
`
  );

program
  .command("send")
  .description("Send file or text securely")
  .argument("[file]", "File to send")
  .option("--text <text>", "Send raw text instead of file")
  .option("--ttl <seconds>", "Time to live in seconds (default: 86400)", "86400")
  .option("--views <number>", "Number of allowed views (default: 1)", "1")
  .option("--paranoid", "Enable paranoid mode (delete on first access)", false)
  .action(async (file, options) => {
    try {
      let buffer;

      if (options.text) {
        buffer = Buffer.from(options.text, "utf-8");
      } else if (file) {
        if (!fs.existsSync(file)) {
          console.error("❌ File not found:", file);
          process.exit(1);
        }
        buffer = fs.readFileSync(file);
      } else {
        console.error("❌ Provide a file or use --text");
        process.exit(1);
      }

      const key = generateKey();
      const encrypted = await encryptBytes(buffer, key);

      const payload = {
        v: 1,
        alg: "AES-GCM",
        type: file ? "file" : "text",
        filename: file || null,
        mime: "application/octet-stream",
        ...encrypted
      };

      const res = await fetch(`${API_URL}/api/drops`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ciphertext: JSON.stringify(payload),
          ttl_seconds: Number(options.ttl),
          views: Number(options.views),
          kind: file ? "file" : "text",
          size_bytes: buffer.length,
          paranoid: options.paranoid
        })
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      const data = await res.json();
      const url = `${API_URL}/d/${data.id}#k=${encodeKey(key)}`;

      console.log("\n=== 🔐 BurnAfterRead ===\n");
      console.log("Secure link:");
      console.log(url);
      console.log("\n⚠️  Share carefully. It will self-destruct.\n");

    } catch (e) {
      console.error("❌ Error:", e.message);
    }
  });

program
  .command("receive")
  .description("Receive and decrypt a secure drop from a link")
  .argument("<url>", "Full drop URL including #k= fragment")
  .option("--out <file>", "Write decrypted output to file instead of stdout")
  .action(async (rawUrl, options) => {
    try {
      // parse fragment from URL — must be passed as a single quoted string
      const hashIndex = rawUrl.indexOf("#");
      if (hashIndex === -1) {
        console.error("❌ URL has no fragment (#k=...). The decryption key must be included.");
        process.exit(1);
      }

      const fragment = rawUrl.slice(hashIndex + 1);
      const params = new URLSearchParams(fragment);
      const encodedKey = params.get("k");

      if (!encodedKey) {
        console.error("❌ No key found in URL fragment. Expected #k=<key>");
        process.exit(1);
      }

      if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) {
        console.error("❌ Key format invalid. Expected 43-character Base64url string.");
        process.exit(1);
      }

      // extract drop id from path
      const baseUrl = rawUrl.slice(0, hashIndex);
      const pathParts = new URL(baseUrl).pathname.split("/").filter(Boolean);
      if (pathParts.length < 2 || pathParts[0] !== "d") {
        console.error("❌ URL path format invalid. Expected /d/<id>");
        process.exit(1);
      }
      const id = pathParts[1];

      // fetch ciphertext from API
      const apiBase = new URL(baseUrl).origin;
      const res = await fetch(`${apiBase}/api/drops/${id}`, {
        method: "GET",
        headers: { "cache-control": "no-store" }
      });

      if (!res.ok) {
        const maybeError = await res.json().catch(() => null);
        const msg = maybeError?.error || res.statusText;
        console.error(`❌ Server returned ${res.status}: ${msg}`);
        process.exit(1);
      }

      const data = await res.json();
      const payload = JSON.parse(data.ciphertext);
      const key = decodeKey(encodedKey);

      const plainBuffer = await decryptBytes(payload, key);

      if (options.out) {
        fs.writeFileSync(options.out, plainBuffer);
        console.log(`\n✅ Decrypted and saved to: ${options.out}\n`);
      } else if (payload.type === "file") {
        // for files without --out, save using original filename
        const filename = payload.filename || `burnafter-${id}`;
        fs.writeFileSync(filename, plainBuffer);
        console.log(`\n✅ File saved as: ${filename}\n`);
      } else {
        // text: print to stdout
        console.log("\n=== 🔐 Decrypted message ===\n");
        console.log(plainBuffer.toString("utf-8"));
        console.log();
      }

    } catch (e) {
      console.error("❌ Error:", e.message);
      process.exit(1);
    }
  });

program
  .command("help")
  .description("Show help")
  .action(() => {
    program.outputHelp();
  });

program.parse();
