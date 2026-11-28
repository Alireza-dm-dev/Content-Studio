/**
 * n8n TRIAL send: deliver a saved post's real outbound publish body to a
 * separately configured trial webhook — never to production.
 *
 * Isolation model (see docs/N8N_TRIAL_SEND.md):
 *   - The destination is ONLY the admin-configured Settings row
 *     N8N_PUBLISHED_POST_TRIAL_WEBHOOK_URL. No env fallback, no production
 *     fallback, never a URL from the request.
 *   - It is validated on save AND immediately before every send: it must not
 *     equal the production publish or delete destination (scheme/host/default
 *     port normalized, path case preserved), must be https, have no
 *     credentials/fragment, and its host must be an approved n8n host (the
 *     production webhook hosts, or the server-side env allowlist
 *     N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS — not editable via Settings).
 *   - The host is resolved once; every resolved address must be public
 *     (no loopback, private, link-local, metadata, CGNAT, multicast, ...), and
 *     the connection is pinned to that address (no DNS rebinding window).
 *   - Redirects are never followed; responses are read with a hard byte cap.
 *
 * The only loopback exception is an explicit TEST policy
 * (N8N_TRIAL_WEBHOOK_TEST_POLICY=allow-loopback), refused when NODE_ENV is
 * "production".
 */
import { randomUUID } from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { prisma } from "@/lib/prisma";

// ── Settings keys ────────────────────────────────────────────────────────────
export const TRIAL_URL_KEY = "N8N_PUBLISHED_POST_TRIAL_WEBHOOK_URL";
export const TRIAL_AUTH_MODE_KEY = "N8N_PUBLISHED_POST_TRIAL_WEBHOOK_AUTH_MODE";
export const TRIAL_HEADER_NAME_KEY = "N8N_PUBLISHED_POST_TRIAL_WEBHOOK_HEADER_NAME";
export const TRIAL_HEADER_VALUE_KEY = "N8N_PUBLISHED_POST_TRIAL_WEBHOOK_HEADER_VALUE";
export const TRIAL_SETTING_KEYS = Object.freeze([
  TRIAL_URL_KEY,
  TRIAL_AUTH_MODE_KEY,
  TRIAL_HEADER_NAME_KEY,
  TRIAL_HEADER_VALUE_KEY,
]);
const PRODUCTION_KEYS = ["N8N_PUBLISHED_POST_WEBHOOK_URL", "N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL"];

export const TRIAL_TIMEOUT_MS = 30000;
export const TRIAL_MAX_RESPONSE_BYTES = 64 * 1024;
export const TRIAL_MODE_HEADER = "X-Content-Studio-Mode";
export const TRIAL_ID_HEADER = "X-Content-Studio-Trial-Id";

export const DOWNSTREAM_WARNING =
  "An n8n test webhook can execute downstream workflow nodes, including publishing and database operations. Make sure the workflow is safe to execute before running a trial.";

// ── Errors ───────────────────────────────────────────────────────────────────
const fail = (code, error, field) => ({ ok: false, code, error, ...(field ? { field } : {}) });

// ── Header authentication ────────────────────────────────────────────────────
const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_HEADERS = new Set([
  "host", "content-length", "content-type", "transfer-encoding", "connection",
  "keep-alive", "upgrade", "te", "trailer", "expect", "cookie", "set-cookie",
  "proxy-authorization", "proxy-connection", "x-forwarded-for", "x-forwarded-host",
  "x-forwarded-proto", "forwarded", "x-real-ip",
  TRIAL_MODE_HEADER.toLowerCase(), TRIAL_ID_HEADER.toLowerCase(),
]);
const RESERVED_PREFIXES = ["proxy-", "sec-", "x-content-studio-"];

export function validateHeaderName(name) {
  if (typeof name !== "string" || !name) return fail("TRIAL_HEADER_NAME_INVALID", "Enter a header name.", "headerName");
  if (name.length > 64 || !TOKEN_RE.test(name)) {
    return fail("TRIAL_HEADER_NAME_INVALID", "The header name contains characters that are not allowed in an HTTP header name.", "headerName");
  }
  const lower = name.toLowerCase();
  if (RESERVED_HEADERS.has(lower) || RESERVED_PREFIXES.some((p) => lower.startsWith(p))) {
    return fail("TRIAL_HEADER_NAME_RESERVED", `"${name}" is a reserved transport header and cannot be used for authentication.`, "headerName");
  }
  return { ok: true };
}

export function validateHeaderValue(value) {
  if (typeof value !== "string" || !value) return fail("TRIAL_HEADER_VALUE_INVALID", "Enter the header secret.", "secret");
  if (value.length > 1024) return fail("TRIAL_HEADER_VALUE_INVALID", "The header secret is too long (max 1024 characters).", "secret");
  // Visible ASCII, space and tab only: no CR/LF/NUL (header injection).
  if (!/^[\t\x20-\x7e]+$/.test(value) || value !== value.trim()) {
    return fail("TRIAL_HEADER_VALUE_INVALID", "The header secret contains characters that are not allowed (line breaks, control characters, or leading/trailing spaces).", "secret");
  }
  return { ok: true };
}

// ── URL parsing / normalization ──────────────────────────────────────────────
function testLoopbackPolicy() {
  return process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY === "allow-loopback" && process.env.NODE_ENV !== "production";
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Parse a configured trial URL; syntax rules only (no DNS). */
export function parseTrialUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return fail("TRIAL_URL_INVALID", "Enter the trial webhook URL.", "url");
  const value = raw.trim();
  if (value.length > 2048) return fail("TRIAL_URL_INVALID", "The trial webhook URL is too long.", "url");
  if (value.includes("#")) return fail("TRIAL_URL_INVALID", "The trial webhook URL must not contain a fragment (#).", "url");
  let url;
  try {
    url = new URL(value);
  } catch {
    return fail("TRIAL_URL_INVALID", "The trial webhook URL is not a valid URL.", "url");
  }
  if (url.username || url.password) {
    return fail("TRIAL_URL_INVALID", "The trial webhook URL must not contain a username or password. Use header authentication instead.", "url");
  }
  const loopbackTest = testLoopbackPolicy() && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(loopbackTest && url.protocol === "http:")) {
    return fail("TRIAL_URL_INVALID", "The trial webhook URL must use https://.", "url");
  }
  if (!url.hostname) return fail("TRIAL_URL_INVALID", "The trial webhook URL has no host name.", "url");
  return { ok: true, url, loopbackTest };
}

/**
 * Comparable form of a destination, built CONSERVATIVELY so that anything n8n
 * (or a proxy in front of it) could route to the same webhook compares equal:
 *   - scheme and host lower-cased, default port dropped (WHATWG URL), trailing
 *     dot on the host removed;
 *   - path percent-decoded repeatedly (so %70, %2F, %252F, %2e%2e collapse),
 *     dot segments resolved, repeated slashes collapsed, trailing slash dropped;
 *   - path CASE PRESERVED (n8n webhook paths are case-sensitive);
 *   - query string and fragment IGNORED (a different query still reaches the
 *     same production webhook).
 * Returns null when unparseable.
 */
export function canonicalDestination(raw) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  const host = url.host.toLowerCase().replace(/\.(?=(:\d+)?$)/, "");
  let path = url.pathname;
  for (let i = 0; i < 4; i += 1) {
    let next;
    try {
      next = decodeURIComponent(path);
    } catch {
      next = path.replace(/%([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
    }
    if (next === path) break;
    path = next;
  }
  const out = [];
  for (const seg of path.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `${url.protocol}//${host}/${out.join("/")}`;
}

/** Every configured production destination (Settings rows and env, raw). */
async function productionDestinations() {
  const out = [];
  try {
    const rows = await prisma.settings.findMany({ where: { key: { in: PRODUCTION_KEYS } } });
    for (const r of rows) if (r?.value) out.push(r.value);
  } catch {
    // DB unavailable — env values below still apply
  }
  for (const k of PRODUCTION_KEYS) if (process.env[k]) out.push(process.env[k]);
  return out;
}

function hostOf(raw) {
  try {
    return new URL(String(raw).trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Approved trial hosts: the production n8n webhook hosts + server-side env allowlist. */
async function approvedHosts(productionUrls) {
  const hosts = new Set(productionUrls.map(hostOf).filter(Boolean));
  for (const h of String(process.env.N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS || "").split(",")) {
    const v = h.trim().toLowerCase();
    if (v) hosts.add(v);
  }
  return hosts;
}

// ── Address policy ───────────────────────────────────────────────────────────
// Separate lists: a single BlockList would also match plain IPv4 addresses
// against the IPv4-mapped IPv6 range, so every v4 address would be "blocked".
const blockedV4 = new net.BlockList();
const blockedV6 = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blockedV4.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 96] /* unspecified, loopback, IPv4-compatible */, ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]) blockedV6.addSubnet(addr, prefix, "ipv6");

/** True when an address must never be contacted (loopback, private, metadata, ...). */
export function isForbiddenAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blockedV4.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped / -compatible forms (::ffff:a.b.c.d, ::ffff:7f00:1): never
    // needed for a public n8n host, so always refused.
    if (/^::ffff:/i.test(address) || /^::(\d+\.){3}\d+$/.test(address)) return true;
    return blockedV6.check(address, "ipv6");
  }
  return true; // not an IP at all
}

/**
 * Full destination validation (used on save and before every send).
 * Returns { ok: true, url, address, family, destinationType } or a failure.
 * `resolve` is injectable for tests; defaults to dns.promises.lookup.
 */
export async function validateTrialDestination(raw, { resolve = (h) => dns.promises.lookup(h, { all: true, verbatim: true }) } = {}) {
  const parsed = parseTrialUrl(raw);
  if (!parsed.ok) return parsed;
  const { url, loopbackTest } = parsed;

  const production = await productionDestinations();
  const mine = canonicalDestination(url.href);
  if (production.some((p) => canonicalDestination(p) === mine)) {
    return fail("TRIAL_URL_IS_PRODUCTION", "The trial webhook URL is the same as a production webhook. Use the n8n Test URL or a separate diagnostic workflow.", "url");
  }

  const destinationType = describeDestination(url);
  if (loopbackTest) {
    return { ok: true, url, address: url.hostname === "localhost" ? "127.0.0.1" : url.hostname.replace(/^\[|\]$/g, ""), family: url.hostname.includes(":") ? 6 : 4, destinationType, testPolicy: true };
  }

  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    return fail("TRIAL_URL_HOST_NOT_ALLOWED", "The trial webhook must use the n8n host name, not an IP address.", "url");
  }
  const hosts = await approvedHosts(production);
  if (!hosts.has(url.hostname.toLowerCase())) {
    return fail(
      "TRIAL_URL_HOST_NOT_ALLOWED",
      "The trial webhook host is not an approved n8n host. It must match the production n8n webhook host, or be listed by the server administrator in N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS.",
      "url",
    );
  }

  let addresses;
  try {
    addresses = await resolve(url.hostname);
  } catch {
    return fail("TRIAL_URL_DNS_FAILED", "The trial webhook host name could not be resolved.", "url");
  }
  const list = (Array.isArray(addresses) ? addresses : [addresses]).filter((a) => a && a.address);
  if (!list.length) return fail("TRIAL_URL_DNS_FAILED", "The trial webhook host name could not be resolved.", "url");
  if (list.some((a) => isForbiddenAddress(a.address))) {
    return fail("TRIAL_URL_UNSAFE_ADDRESS", "The trial webhook host resolves to a private, local or reserved network address, which is not allowed.", "url");
  }
  return { ok: true, url, address: list[0].address, family: list[0].family || net.isIP(list[0].address), destinationType };
}

export function describeDestination(url) {
  return url.pathname.startsWith("/webhook-test/")
    ? "n8n Test URL (/webhook-test/)"
    : "Custom trial webhook (e.g. a diagnostic workflow)";
}

/** Masked display form: scheme, host and first path segment only. */
export function maskTrialUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    const first = u.pathname.split("/").filter(Boolean)[0];
    return `${u.protocol}//${u.host}/${first ? `${first}/` : ""}…`;
  } catch {
    return "(invalid URL)";
  }
}

// ── Stored configuration ─────────────────────────────────────────────────────
export async function readTrialConfig() {
  const rows = await prisma.settings.findMany({ where: { key: { in: [...TRIAL_SETTING_KEYS] } } });
  const get = (k) => rows.find((r) => r.key === k)?.value || "";
  return {
    url: get(TRIAL_URL_KEY),
    authMode: get(TRIAL_AUTH_MODE_KEY) === "header" ? "header" : "none",
    headerName: get(TRIAL_HEADER_NAME_KEY),
    headerValue: get(TRIAL_HEADER_VALUE_KEY),
  };
}

/** Validate the auth part of an effective configuration. */
export function validateTrialAuth({ authMode, headerName, headerValue }) {
  if (authMode !== "none" && authMode !== "header") return fail("TRIAL_AUTH_MODE_INVALID", "Authentication must be None or Header Authentication.", "authMode");
  if (authMode === "none") return { ok: true };
  const n = validateHeaderName(headerName);
  if (!n.ok) return n;
  if (!headerValue) return fail("TRIAL_HEADER_VALUE_INVALID", "Header Authentication needs a header secret.", "secret");
  return validateHeaderValue(headerValue);
}

// ── Payload safety ───────────────────────────────────────────────────────────
const PRIVATE_PATH_RE = /^\/(Users|home|var|private|tmp|etc|root|app|opt|srv|mnt|Volumes|data)\//;

/**
 * Fields that must never leave the server: private filesystem paths, file://
 * URLs, URLs with embedded credentials, or known server secrets.
 */
const SECRET_NAME_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|WEBHOOK_URL|DATABASE_URL)/i;

/**
 * Credential values the server knows about: environment variables and Settings
 * rows whose NAME looks like a credential (…KEY, …SECRET, …TOKEN, …PASSWORD,
 * webhook URLs, DATABASE_URL). Values shorter than 8 characters are ignored.
 */
export async function knownServerSecrets() {
  const out = [];
  for (const [k, v] of Object.entries(process.env)) if (SECRET_NAME_RE.test(k) && typeof v === "string") out.push(v);
  try {
    const rows = await prisma.settings.findMany();
    for (const r of rows || []) if (SECRET_NAME_RE.test(r.key) && typeof r.value === "string") out.push(r.value);
  } catch {
    // DB unavailable — environment values still apply
  }
  return out.filter((s) => s.length >= 8);
}

export function findSensitivePayloadFields(payload, { extraSecrets = [] } = {}) {
  const secrets = extraSecrets.filter((s) => typeof s === "string" && s.length >= 8);
  const cwd = process.cwd();
  const out = [];
  const visit = (value, field) => {
    if (typeof value === "string") {
      let reason = null;
      if (/^file:/i.test(value)) reason = "file:// URL";
      else if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) reason = "filesystem path";
      else if (PRIVATE_PATH_RE.test(value) || (cwd.length > 1 && value.includes(cwd))) reason = "server filesystem path";
      else if (secrets.some((s) => value.includes(s))) reason = "server credential";
      else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        try {
          const u = new URL(value);
          if (u.username || u.password) reason = "URL with embedded credentials";
        } catch {
          // not a URL
        }
      }
      if (reason) out.push({ field, reason });
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${field}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, field ? `${field}.${k}` : k);
    }
  };
  visit(payload, "");
  return out;
}

// ── Concurrency (process-local) ──────────────────────────────────────────────
const inFlight = new Set();
export function acquireTrialLock(postId) {
  if (inFlight.has(postId)) return false;
  inFlight.add(postId);
  return true;
}
export function releaseTrialLock(postId) {
  inFlight.delete(postId);
}

// ── Redaction ────────────────────────────────────────────────────────────────
/**
 * Representations of a secret that a downstream echo could plausibly contain:
 * raw, JSON-escaped, URL-encoded (both space forms), HTML-escaped, base64 and
 * base64url. Other transformations (hashing, partial echoes, re-encodings not
 * listed here, a secret split across the 64 KB cut) cannot be detected.
 */
export function secretVariants(secret) {
  if (typeof secret !== "string" || secret.length < 4) return [];
  const html = secret.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const b64 = Buffer.from(secret, "utf8").toString("base64");
  const v = new Set([
    secret,
    JSON.stringify(secret).slice(1, -1),
    encodeURIComponent(secret),
    encodeURIComponent(secret).replace(/%20/g, "+"),
    html,
    html.replace(/&#39;/g, "&#x27;"),
    b64,
    b64.replace(/=+$/, ""),
    Buffer.from(secret, "utf8").toString("base64url"),
  ]);
  return [...v].filter((x) => x.length >= 4).sort((x, y) => y.length - x.length);
}

export function redactSecrets(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets) {
    for (const variant of secretVariants(s)) out = out.split(variant).join("[redacted]");
  }
  return out;
}

// ── Transport ────────────────────────────────────────────────────────────────
/**
 * POST `body` to the validated destination, connecting ONLY to the pinned
 * address. Never follows redirects. Reads at most `maxBytes` of the response
 * (stream aborted beyond that). Never throws.
 * → { kind: "response", status, contentType, buffer, truncated, location }
 *   | { kind: "timeout" } | { kind: "network", errorCode }
 */
export function sendPinnedRequest({ url, address, family, headers, body, timeoutMs = TRIAL_TIMEOUT_MS, maxBytes = TRIAL_MAX_RESPONSE_BYTES }) {
  return new Promise((resolve) => {
    const lib = url.protocol === "https:" ? https : http;
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        agent: false,
        // Pin the connection to the address that passed validation.
        lookup: (_host, opts, cb) => (opts && opts.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk) => {
          if (truncated) return;
          const room = maxBytes - size;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, Math.max(0, room)));
            size = maxBytes;
            truncated = true;
            res.destroy(); // stop reading; nothing beyond the cap is buffered
            finish();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        const finish = () =>
          done({
            kind: "response",
            status: res.statusCode,
            contentType: String(res.headers["content-type"] || ""),
            buffer: Buffer.concat(chunks),
            truncated,
            location: res.headers.location ? true : false,
          });
        res.on("end", finish);
        res.on("error", () => (truncated ? finish() : done({ kind: "network", errorCode: "RESPONSE_READ_FAILED" })));
      },
    );
    const timer = setTimeout(() => {
      done({ kind: "timeout" });
      req.destroy();
    }, timeoutMs);
    req.on("error", (err) => done({ kind: "network", errorCode: err?.code || "NETWORK_ERROR" }));
    req.end(body);
  });
}

const HINTS = {
  404: "n8n returned 404. If you are using an n8n Test URL, open the workflow, click \"Listen for test event\" (n8n listens for about 120 seconds) and run the trial again. A 404 can also mean the path is wrong or the workflow is not active.",
  401: "n8n rejected the request's authentication. Check the trial header name and secret against the Webhook node's Header Auth credential.",
  403: "n8n refused the request. Check the Webhook node's authentication and IP allowlist.",
  429: "n8n is rate limiting requests. Wait before trying again.",
  400: "n8n rejected the request as invalid. Inspect the request JSON and the workflow's expectations.",
};

/** Map a transport outcome to an accurate result state (never "published"). */
export function interpretTrialOutcome(r, { secrets = [] } = {}) {
  if (r.kind === "timeout") {
    return {
      outcome: "timeout",
      label: "Request timed out",
      hint: `No response within ${Math.round(TRIAL_TIMEOUT_MS / 1000)} seconds. n8n may still have received and processed the request.`,
    };
  }
  if (r.kind === "network") {
    return {
      outcome: "network_failure",
      label: "Network failure",
      networkError: r.errorCode,
      hint: "The request could not be completed (connection or DNS failure). It is not known whether n8n received it.",
    };
  }
  const text = redactSecrets(r.buffer.toString("utf8"), secrets);
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const base = {
    httpStatus: r.status,
    responseText: text,
    responseContentType: redactSecrets(r.contentType, secrets).slice(0, 200),
    responseIsJson: json !== null,
    responseEmpty: text.length === 0,
    responseTruncated: r.truncated,
  };
  if (r.status >= 300 && r.status < 400) {
    return { ...base, outcome: "redirect_blocked", label: "Redirect blocked", hint: "The trial webhook answered with a redirect. Redirects are never followed; configure the final webhook URL directly." };
  }
  if (r.status >= 200 && r.status < 300) {
    return {
      ...base,
      outcome: r.truncated ? "response_truncated" : "http_accepted",
      label: r.truncated ? "HTTP accepted — response truncated" : "HTTP accepted",
      hint: "n8n accepted the HTTP request. This alone does not show that the workflow completed or that anything was published.",
    };
  }
  return {
    ...base,
    outcome: "http_rejected",
    label: `HTTP rejected (${r.status})`,
    hint: HINTS[r.status] || (r.status >= 500 ? "n8n reported a server error while handling the request." : "n8n did not accept the request."),
  };
}

export function newTrialId() {
  return randomUUID();
}
