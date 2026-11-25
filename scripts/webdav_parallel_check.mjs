#!/usr/bin/env node
/**
 * Parallel WebDAV smoke test against the Rust harness.
 *
 * Start the harness first (optionally with a synthetic PUT delay):
 *
 *   cd src-tauri && cargo run --example webdav_harness
 *   WEBDAV_HARNESS_PUT_DELAY_MS=500 cargo run --example webdav_harness
 *
 * Then:
 *
 *   node scripts/webdav_parallel_check.mjs
 *
 * It issues 8 parallel PUTs and 8 parallel MKCOLs, retries 429/503 responses
 * according to Retry-After, then verifies every object appears exactly once in
 * PROPFIND and deletes the probe objects. Exit code 1 on any mismatch.
 *
 * This exercises the HTTP server, PUT limiter, temp-file streaming and catalog
 * bookkeeping. The TypeScript IndexQueue/revision guard is covered by vitest.
 */

const BASE = process.env.WEBDAV_URL ?? "http://127.0.0.1:18747/";
const USER = process.env.WEBDAV_USER ?? "harness";
const PASS = process.env.WEBDAV_PASS ?? "harness-pass";
const PUT_COUNT = Number(process.env.PUT_COUNT ?? 8);
const MKCOL_COUNT = Number(process.env.MKCOL_COUNT ?? 8);
const PUT_SIZE_KB = Number(process.env.PUT_SIZE_KB ?? 256);
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 5);
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const auth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;
const body = Buffer.alloc(PUT_SIZE_KB * 1024, 0x61);

function urlFor(path) {
  return new URL(path.replace(/^\/+/, ""), BASE).toString();
}

async function request(method, path, extraHeaders = {}) {
  return fetch(urlFor(path), {
    method,
    headers: {
      Authorization: auth,
      ...extraHeaders,
    },
    body: method === "PUT" ? body : undefined,
    signal: AbortSignal.timeout(120_000),
  });
}

async function withRetry(method, path, extraHeaders = {}) {
  let retries = 0;
  for (;;) {
    const response = await request(method, path, extraHeaders);
    if (response.status !== 429 && response.status !== 503) {
      await response.arrayBuffer();
      return { status: response.status, retries };
    }
    const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
    await response.arrayBuffer();
    retries++;
    if (retries > MAX_RETRIES) {
      return { status: response.status, retries };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(100, retryAfter * 1000))
    );
  }
}

async function listRoot() {
  const response = await request("PROPFIND", "/", { Depth: "1" });
  const xml = await response.text();
  if (response.status !== 207) {
    throw new Error(`PROPFIND returned ${response.status}: ${xml.slice(0, 200)}`);
  }
  return [...xml.matchAll(/<D:href>([^<]*)<\/D:href>/gi)].map((match) =>
    decodeURIComponent(match[1].replace(/\/$/, ""))
  );
}

function countOccurrences(hrefs, suffix) {
  const needle = `/${suffix}`;
  return hrefs.filter((href) => href === needle).length;
}

async function main() {
  const putNames = Array.from(
    { length: PUT_COUNT },
    (_, index) => `pcheck-${RUN_ID}-${index}.bin`
  );
  const mkcolNames = Array.from(
    { length: MKCOL_COUNT },
    (_, index) => `mcheck-${RUN_ID}-${index}`
  );

  const started = performance.now();
  const [puts, mkcols] = await Promise.all([
    Promise.all(putNames.map((name) => withRetry("PUT", `/${name}`))),
    Promise.all(mkcolNames.map((name) => withRetry("MKCOL", `/${name}`))),
  ]);
  const elapsedMs = Math.round(performance.now() - started);

  const failures = [];
  puts.forEach((result, index) => {
    if (result.status !== 201) {
      failures.push(`PUT ${putNames[index]} -> ${result.status}`);
    }
  });
  mkcols.forEach((result, index) => {
    if (result.status !== 201) {
      failures.push(`MKCOL ${mkcolNames[index]} -> ${result.status}`);
    }
  });

  const hrefs = await listRoot();
  for (const name of putNames) {
    const count = countOccurrences(hrefs, name);
    if (count !== 1) failures.push(`${name} appears ${count} times`);
  }
  for (const name of mkcolNames) {
    const count = countOccurrences(hrefs, name);
    if (count !== 1) failures.push(`${name} appears ${count} times`);
  }

  // Clean up so repeated runs stay deterministic.
  await Promise.all([
    ...putNames.map((name) => withRetry("DELETE", `/${name}`)),
    ...mkcolNames.map((name) => withRetry("DELETE", `/${name}`)),
  ]);
  const after = await listRoot();
  for (const name of [...putNames, ...mkcolNames]) {
    if (countOccurrences(after, name) !== 0) {
      failures.push(`${name} still present after DELETE`);
    }
  }

  const summary = {
    elapsedMs,
    puts: puts.map((result) => result.status),
    mkcols: mkcols.map((result) => result.status),
    retries: puts.reduce((sum, result) => sum + result.retries, 0) +
      mkcols.reduce((sum, result) => sum + result.retries, 0),
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
