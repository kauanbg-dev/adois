import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyState, mergeStates, normalizeCode, sanitizeState } from "../../logic.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hits = new Map();
const locks = new Map();

function result(json, status = 200, headers = {}) {
  return { json, status, headers };
}

function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL) return "/tmp";
  return path.join(root, "data");
}

function storePath() {
  return path.join(dataDir(), "casal.json");
}

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function isPersistent() {
  if (kvConfig()) return true;
  return !process.env.VERCEL;
}

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "local";
}

function limited(ip) {
  const now = Date.now();
  const bucket = (hits.get(ip) || []).filter((time) => now - time < 60_000);
  if (bucket.length >= 40) {
    hits.set(ip, bucket);
    return true;
  }
  bucket.push(now);
  hits.set(ip, bucket);
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    if (req.body.length > 300_000) throw new Error("too big");
    return JSON.parse(req.body || "{}");
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > 300_000) throw new Error("too big");
    return JSON.parse(req.body.toString("utf8") || "{}");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 300_000) throw new Error("too big");
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function kvCommand(parts) {
  const kv = kvConfig();
  const res = await fetch(kv.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kv.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts),
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  return res.json();
}

async function readCouple(hash) {
  if (kvConfig()) {
    const data = await kvCommand(["GET", `casal:${hash}`]);
    if (!data?.result) return null;
    return sanitizeState(JSON.parse(data.result));
  }
  let raw;
  try {
    raw = await fs.readFile(storePath(), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(raw);
  const found = parsed?.couples?.[hash];
  return found ? sanitizeState(found) : null;
}

async function writeCouple(hash, state) {
  if (kvConfig()) {
    const data = await kvCommand(["SET", `casal:${hash}`, JSON.stringify(state)]);
    if (data?.error) throw new Error(data.error);
    return;
  }
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  let parsed = { couples: {} };
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.couples) parsed = { couples: {} };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  parsed.couples[hash] = state;
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(parsed));
  await fs.rename(tmp, file);
}

function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

export async function handleCasal(req) {
  if (req.method !== "POST") return result({ error: "method" }, 405);
  if (limited(clientIp(req))) return result({ error: "rate" }, 429);

  let body;
  try {
    body = await readBody(req);
  } catch {
    return result({ error: "json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return result({ error: "json" }, 400);

  const code = normalizeCode(body.code);
  if (!code) return result({ error: "code" }, 400);
  const hash = crypto.createHash("sha256").update(code).digest("hex");

  try {
    const state = await withLock(kvConfig() ? hash : "file", async () => {
      const stored = await readCouple(hash);
      if (!body.state) return stored || emptyState();
      const merged = mergeStates(stored, body.state);
      await writeCouple(hash, merged);
      return merged;
    });
    return result({ ok: true, state, persistent: isPersistent() });
  } catch (err) {
    console.error("casal", err?.message || err);
    return result({ error: "persist" }, 503);
  }
}
