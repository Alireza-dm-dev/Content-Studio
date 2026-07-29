import { NextResponse } from "next/server";
import { getCurrentUser, assertBrandAccess } from "@/lib/auth";
import { buildBrandChatContext, BrandChatContextError } from "@/lib/brand-chat-context";
import { generateBrandChatAnswer } from "@/lib/brand-chat-ai";
import { createRateLimiter } from "@/lib/rate-limiter";
import { mapChatError } from "@/lib/chat-error-mapper";

const chatLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 20 });

const ALLOWED_FIELDS = new Set(["message", "history"]);
const MAX_MESSAGE_CHARS = 2000;
const MAX_BODY_BYTES = 16384;
const MAX_HISTORY_LENGTH = 8;
const MAX_HISTORY_TOTAL_CHARS = 10000;
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

  let totalChars = 0;
  for (const entry of history) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "INVALID_HISTORY";
    if (!ALLOWED_HISTORY_ROLES.has(entry.role)) return "INVALID_HISTORY";
    if (typeof entry.content !== "string") return "INVALID_HISTORY";
    const trimmed = entry.content.trim();
    if (!trimmed) return "INVALID_HISTORY";
    if (trimmed.length > MAX_MESSAGE_CHARS) return "INVALID_HISTORY";
    totalChars += trimmed.length;
  }

  if (totalChars > MAX_HISTORY_TOTAL_CHARS) return "INVALID_HISTORY";

  return history.map((entry) => ({
    role: entry.role,
    content: entry.content.trim(),
  }));
}

export async function POST(request, { params }) {
  try {
    const { id: brandId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return json(mapChatError("AUTH_REQUIRED").body, 401);
    }

    const hasAccess = await assertBrandAccess(brandId);
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

    let contextResult;
    try {
      contextResult = await buildBrandChatContext({ brandId, question: message });
    } catch (err) {
      if (err instanceof BrandChatContextError) {
        return json(mapChatError(err.code).body, mapChatError(err.code).status);
      }
      return json(mapChatError("CONTEXT_UNAVAILABLE").body, 503);
    }

    if (contextResult.error) {
      return json(mapChatError(contextResult.error.code || "CONTEXT_UNAVAILABLE").body, 503);
    }

    const brandName = contextResult.sources.find((s) => s.type === "brand_profile")?.label || "Brand";

    let answer;
    try {
      answer = await generateBrandChatAnswer({
        brandName,
        contextBlock: contextResult.contextBlock,
        question: message,
        history: history || undefined,
      });
    } catch (aiErr) {
      return json(mapChatError(aiErr.code || "AI_PROVIDER_ERROR").body,
        mapChatError(aiErr.code || "AI_PROVIDER_ERROR").status);
    }

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
    };

    return json({
      success: true,
      answer,
      sources: safeSources,
      contextStats,
    });
  } catch (err) {
    console.error("[BrandChat] Unhandled error:", err?.message ?? err);
    return json(mapChatError("INTERNAL_ERROR").body, 500);
  }
}
