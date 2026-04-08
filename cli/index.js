#!/usr/bin/env node

import { Command } from "commander";
import fs from "fs";
import fetch from "node-fetch";
import { generateKey, encryptBytes, encodeKey } from "./crypto.js";

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

/**
 * Alias: burnafter help
 */
program
  .command("help")
  .description("Show help")
  .action(() => {
    program.outputHelp();
  });

program.parse();