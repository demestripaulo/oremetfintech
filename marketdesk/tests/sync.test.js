// Sync test: verifies cloudflare/public/ matches frontend/.
// Catches drift between the two directories after editing frontend files
// without running `npm run sync-assets`.
// Run with: node --test tests/sync.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = join(__dirname, '../frontend');
const PUBLIC_DIR = join(__dirname, '../cloudflare/public');

function collectFiles(dir) {
  const files = {};
  function walk(current) {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const rel = relative(dir, full);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files[rel] = readFileSync(full, 'utf8');
      }
    }
  }
  walk(dir);
  return files;
}

test('cloudflare/public and frontend have identical files', () => {
  const frontend = collectFiles(FRONTEND_DIR);
  const pub = collectFiles(PUBLIC_DIR);

  const frontendPaths = Object.keys(frontend).sort();
  const publicPaths = Object.keys(pub).sort();

  assert.deepEqual(
    publicPaths,
    frontendPaths,
    `File list mismatch.\nOnly in public: ${publicPaths.filter(p => !frontend[p])}\nOnly in frontend: ${frontendPaths.filter(p => !pub[p])}`
  );

  for (const path of frontendPaths) {
    assert.equal(
      pub[path],
      frontend[path],
      `Content differs: ${path} — run "npm run sync-assets" in marketdesk/cloudflare/`
    );
  }
});
