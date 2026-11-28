import { sha256Hex } from "@/lib/content-digest";

// Per-post publishing / delivery mode (V1.3.56). Isomorphic: no server imports,
// so the upload forms share the exact same values, labels and binding shape.
//
// `deliveryMode` on PublishedPost is SEPARATE from `status` (draft/published):
//   null        legacy row: existing behaviour (edits auto-send to production)
//   production  production delivery enabled (edits auto-send, as before)
//   trial       created for a trial: edits NEVER auto-send to production
//   save_only   saved only:          edits NEVER auto-send to production
// A trial or save_only post enters production only through the explicit
// Send to n8n operation (2xx promotes it to "production").

export const PUBLISHING_MODE_PRODUCTION = "production";
export const PUBLISHING_MODE_TRIAL = "trial";
export const PUBLISHING_MODE_SAVE_ONLY = "save_only";
export const PUBLISHING_MODES = Object.freeze([
  PUBLISHING_MODE_PRODUCTION,
  PUBLISHING_MODE_TRIAL,
  PUBLISHING_MODE_SAVE_ONLY,
]);

export const PRODUCTION_DELIVERY_SKIPPED_CODE = "PRODUCTION_DELIVERY_SKIPPED";
export const PRODUCTION_DELIVERY_SKIPPED_MESSAGE =
  "Production delivery skipped because this post is in Trial or Save Only mode.";

export const TRIAL_UPLOAD_WARNING =
  "Trial sends this post to the configured n8n trial webhook only. Make sure the test workflow is listening and safe to execute. n8n test workflows may still execute publishing or database operations.";

export const PROMOTION_WARNING =
  "This post is currently in Trial / Save Only mode. Sending it to production will enable automatic production delivery on future edits.";

export function isPublishingMode(value) {
  return PUBLISHING_MODES.includes(value);
}

/**
 * Edits auto-send to the production webhook ONLY for legacy (null) and
 * production rows. Any other stored value, including an unknown one, is
 * treated as "not in production delivery" (fail safe).
 */
export function allowsAutomaticProductionDelivery(deliveryMode) {
  return deliveryMode === null || deliveryMode === undefined || deliveryMode === PUBLISHING_MODE_PRODUCTION;
}

/** Trial / Save Only rows: a manual production send must be confirmed and promotes them. */
export function isNonProductionDeliveryMode(deliveryMode) {
  return !allowsAutomaticProductionDelivery(deliveryMode);
}

const LABELS = { production: "Production", trial: "Trial", save_only: "Save Only" };
/** Display label; null (legacy) has no label so it never implies confirmed delivery. */
export function deliveryModeLabel(deliveryMode) {
  return LABELS[deliveryMode] || null;
}

/**
 * Create route: an absent field keeps the existing behaviour (Production).
 * A supplied value must be one of the three modes.
 */
export function parseCreatePublishingMode(raw) {
  if (raw === null || raw === undefined || raw === "") return { ok: true, mode: PUBLISHING_MODE_PRODUCTION, explicit: false };
  if (typeof raw === "string" && isPublishingMode(raw)) return { ok: true, mode: raw, explicit: true };
  return invalid();
}

/**
 * Adapt route. Without publishingMode the legacy boolean keeps its meaning
 * (true → production, otherwise save_only). When publishingMode is supplied it
 * is authoritative, and an explicit sendToN8n that disagrees with it is
 * REJECTED, so a legacy flag can never turn Trial / Save Only into a production
 * send (or silently drop a requested one).
 */
export function parseAdaptPublishingMode(rawMode, rawSendToN8n) {
  if (rawMode === null || rawMode === undefined || rawMode === "") {
    return { ok: true, mode: rawSendToN8n === true ? PUBLISHING_MODE_PRODUCTION : PUBLISHING_MODE_SAVE_ONLY, explicit: false };
  }
  if (typeof rawMode !== "string" || !isPublishingMode(rawMode)) return invalid();
  if (rawSendToN8n !== undefined && rawSendToN8n !== null) {
    const wantsProduction = rawSendToN8n === true;
    if (wantsProduction !== (rawMode === PUBLISHING_MODE_PRODUCTION)) {
      return {
        ok: false,
        code: "PUBLISHING_MODE_CONFLICT",
        error: "publishingMode conflicts with sendToN8n. Send publishingMode only.",
      };
    }
  }
  return { ok: true, mode: rawMode, explicit: true };
}

function invalid() {
  return {
    ok: false,
    code: "INVALID_PUBLISHING_MODE",
    error: `Invalid publishingMode. Must be one of: ${PUBLISHING_MODES.join(", ")}.`,
  };
}

// Fields that carry the mode / confirmation / submission id themselves are
// never part of a binding.
const BINDING_EXCLUDED = new Set(["publishingMode", "trialConfirmation", "sendToN8n", "submissionId"]);
const normText = (v) => String(v).replace(/\r\n?/g, "\n");
const isFileLike = (v) => v && typeof v === "object" && typeof v.size === "number" && typeof v.name === "string" && typeof v.arrayBuffer === "function";

/**
 * The form state a Trial upload confirmation is bound to: EVERY submitted field
 * except the mode/confirmation fields. Files are bound by name, size and
 * SHA-256 of their CONTENT (not MIME type: a browser sends "" as
 * application/octet-stream). The browser calls this on the FormData it is about
 * to send, the server on request.formData(): the SAME function on both sides,
 * so any material change between confirming and submitting (including a
 * different file with the same name and size, or a forged request) yields a
 * different binding and is refused. Async: hashing needs Web Crypto
 * (browsers: HTTPS or localhost only).
 */
export async function uploadTrialBinding(brandId, formData) {
  const fields = {};
  for (const [key, value] of formData.entries()) {
    if (BINDING_EXCLUDED.has(key)) continue;
    const entry = isFileLike(value)
      ? { file: value.name, size: value.size, sha256: await sha256Hex(await value.arrayBuffer()) }
      : normText(value);
    (fields[key] ||= []).push(entry);
  }
  return { v: 2, kind: "upload", mode: PUBLISHING_MODE_TRIAL, brandId: String(brandId), fields };
}

/**
 * Adaptation binding over the JSON request body (same rule: every field except
 * the mode/confirmation ones; base64 file content bound by its SHA-256).
 */
export async function adaptTrialBinding(brandId, sourcePostId, body) {
  const fields = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (BINDING_EXCLUDED.has(key)) continue;
    if (key === "files" && Array.isArray(value)) {
      fields.files = await Promise.all(value.map(async (f) => ({
        name: String(f?.name ?? ""),
        type: String(f?.type ?? ""),
        length: typeof f?.content === "string" ? f.content.length : 0,
        sha256: typeof f?.content === "string" ? await sha256Hex(f.content) : null,
      })));
    } else if (typeof value === "string") {
      fields[key] = normText(value);
    } else {
      fields[key] = value === undefined ? null : value;
    }
  }
  return { v: 2, kind: "adapt", mode: PUBLISHING_MODE_TRIAL, brandId: String(brandId), sourcePostId: String(sourcePostId), fields };
}

/** Deterministic JSON (sorted keys) so client and server serialize a binding identically. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}
