#!/usr/bin/env node
/**
 * Print a random SESSION_SECRET (48 letters and digits, about 285 bits).
 * `npm run secret` — or, without a terminal, open /secret.html on your builder.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateSecret(length = 48) {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // 248 = 4 * 62: reject the top values so every character is equally likely.
      if (byte < 248 && out.length < length) out += ALPHABET[byte % 62];
    }
  }
  return out;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href || process.argv[1]?.endsWith('generate-secret.mjs')) {
  console.log(generateSecret());
}
