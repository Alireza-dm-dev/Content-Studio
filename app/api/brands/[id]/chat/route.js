import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canUserAccessBrand } from "@/lib/brand-access";
import { buildBrandChatContext, BrandChatContextError } from "@/lib/brand-chat-context";
import { generateBrandChatAnswer } from "@/lib/brand-chat-ai";
import { createRateLimiter } from "@/lib/rate-limiter";
import { mapChatError } from "@/lib/chat-error-mapper";
import { BRAND_CHAT_CONFIG } from "@/lib/brand-chat-config";
import { normalizeHistory } from "@/lib/brand-chat-history";

// Server-side cap for one chat request. Must be a literal (Next static analysis); keep equal to
// BRAND_CHAT_CONFIG.routeMaxDurationS, which the provider deadline is derived from.
export const maxDuration = 120;

const chatLimiter = createRateLimiter(BRAND_CHAT_CONFIG.rateLimit);

const ALLOWED_FIELDS = new Set(["message", "history"]);
const MAX_MESSAGE_CHARS = BRAND_CHAT_CONFIG.maxMessageChars;
const MAX_BODY_BYTES = BRAND_CHAT_CONFIG.maxBodyBytes;
const MAX_HISTORY_LENGTH = BRAND_CHAT_CONFIG.maxHistoryEntries;
const ALLOWED_HISTORY_ROLES = new Set(["user", "assistant"]);

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readBoundedJsonBody(request, maxBytes) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number.parseInt(contentLength, 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed > maxBytes) {
      return { error: "PAYLOAD_TOO_LARGE" };
    }
  }

  if (!request.body) {
    return { error: "INVALID_JSON" };
  }

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel().catch(() => {});
        return { error: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "INVALID_JSON" };
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    return { error: "INVALID_JSON" };
  }

  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: "INVALID_JSON" };
  }
}

function validateHistory(history) {
  if (history === undefined || history === null) return null;
  if (!Array.isArray(history)) return "INVALID_HISTORY";

  if (history.length > MAX_HISTORY_LENGTH) return "INVALID_HISTORY";

  for (const entry of history) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "INVALID_HISTORY";
    if (!ALLOWED_HISTORY_ROLES.has(entry.role)) return "INVALID_HISTORY";
    if (typeof entry.content !== "string") return "INVALID_HISTORY";
    const trimmed = entry.content.trim();
    if (!trimmed) return "INVALID_HISTORY";
    if (trimmed.length > MAX_MESSAGE_CHARS) return "INVALID_HISTORY";
  }

  // Total size is bounded by MAX_BODY_BYTES; the prompt budget is applied later (budgetHistory).
  return normalizeHistory(history);
}

export async function POST(request, { params }) {
  try {
    const { id: brandId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return json(mapChatError("AUTH_REQUIRED").body, 401);
    }

    const hasAccess = await canUserAccessBrand(user, brandId);
    if (!hasAccess) {
      return json(mapChatError("BRAND_ACCESS_DENIED").body, 403);
    }

    const contentType = request.headers.get("content-type") || "";
    const normalizedMime = contentType.split(";")[0].trim().toLowerCase();
    if (normalizedMime !== "application/json") {
      return json(mapChatError("UNSUPPORTED_MEDIA_TYPE").body, 415);
    }

    const readResult = await readBoundedJsonBody(request, MAX_BODY_BYTES);
    if (readResult.error === "PAYLOAD_TOO_LARGE") {
      return json(mapChatError("PAYLOAD_TOO_LARGE").body, 413);
    }
    if (readResult.error === "INVALID_JSON") {
      return json(mapChatError("INVALID_JSON").body, 400);
    }

    const body = readResult.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(mapChatError("INVALID_JSON").body, 400);
    }

    const unknownFields = Object.keys(body).filter((k) => !ALLOWED_FIELDS.has(k));
    if (unknownFields.length > 0) {
      return json(mapChatError("INVALID_JSON").body, 400);
    }

    const rawMessage = body.message;

    if (typeof rawMessage !== "string") {
      return json(mapChatError("INVALID_MESSAGE").body, 400);
    }

    const message = rawMessage.trim();

    if (!message) {
      return json(mapChatError("INVALID_MESSAGE").body, 400);
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      return json(mapChatError("MESSAGE_TOO_LONG").body, 400);
    }

    const history = validateHistory(body.history);
    if (history === "INVALID_HISTORY") {
      return json(mapChatError("INVALID_HISTORY").body, 400);
    }

    const rateKey = `${user.id}:${brandId}`;
    const rateResult = chatLimiter.check(rateKey);
    if (!rateResult.allowed) {
      const retryAfter = Math.max(1, rateResult.retryAfter);
      const mapped = mapChatError("RATE_LIMITED", { retryAfter });
      const res = json(mapped.body, 429);
      res.headers.set("Retry-After", String(retryAfter));
      return res;
    }

    const requestId = crypto.randomUUID();
    const started = Date.now();

    let contextResult;
    try {
      contextResult = await buildBrandChatContext({
        brandId,
        question: message,
        // Follow-ups ("turn number 3 into a post") retrieve against the recent conversation too.
        retrievalHint: (history || []).slice(-4).map((m) => m.content).join("\n"),
      });
    } catch (err) {
      if (err instanceof BrandChatContextError) {
        return json(mapChatError(err.code).body, mapChatError(err.code).status);
      }
      console.error("[BrandChat]", requestId, "context build failed:", err?.message ?? err);
      return json(mapChatError("CONTEXT_UNAVAILABLE").body, 503);
    }

    if (contextResult.error) {
      const mapped = mapChatError(contextResult.error.code || "CONTEXT_UNAVAILABLE");
      return json(mapped.body, mapped.status);
    }

    const brandName = contextResult.brandName || "Brand";

    // Nothing is persisted server-side: history is client-held, so a failed generation can never
    // leave an assistant message behind. Only a validated answer is returned.
    let generated;
    try {
      generated = await generateBrandChatAnswer({
        brandName,
        contextBlock: contextResult.contextBlock,
        question: message,
        history: history || undefined,
        requestId,
        signal: request.signal,
      });
    } catch (aiErr) {
      const mapped = mapChatError(aiErr.code || "CHAT_PROVIDER_ERROR");
      console.warn("[BrandChat]", JSON.stringify({
        requestId, brandId, ok: false, code: mapped.body.code,
        contextChars: contextResult.stats.totalChars, references: contextResult.stats.referenceCount,
        durationMs: Date.now() - started,
      }));
      return json({ ...mapped.body, requestId }, mapped.status);
    }
    const answer = generated.answer;

    const safeSources = contextResult.sources.map((s) => ({
      type: s.type,
      label: s.label,
      date: s.date || null,
      platform: s.platform || null,
    }));

    const contextStats = {
      totalCharacters: contextResult.stats.totalChars,
      calendarCount: contextResult.stats.calendarCount,
      calendarPostCount: contextResult.stats.calendarPostCount,
      publishedPostCount: contextResult.stats.publishedPostCount,
      truncated: !!contextResult.stats.totalTruncated,
      referenceCount: contextResult.stats.referenceCount,
    };

    return json({
      success: true,
      answer,
      requestId,
      answerTruncated: generated.truncated,
      sources: safeSources,
      contextStats,
    });
  } catch (err) {
    console.error("[BrandChat] Unhandled error:", err?.message ?? err);
    return json(mapChatError("INTERNAL_ERROR").body, 500);
  }
}
