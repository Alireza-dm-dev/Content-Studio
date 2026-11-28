"use client";

import { useEffect, useState } from "react";

/**
 * Server-authoritative webhook payload for a SAVED published post.
 *
 * Fetches GET /api/brands/[brandId]/published-posts/[postId]/payload, the same
 * canonical payload sendPublishedPostToN8n builds. The JSON viewer, Copy JSON
 * and Download JSON must all use `text` from here so they agree byte-for-byte.
 *
 * `version` must change whenever the saved post may have changed (edit, send,
 * reopen of the panel); a new version discards the old snapshot and refetches.
 * On failure there is NO browser-side fallback: the caller shows `error` and
 * offers `retry`.
 *
 * Returns { status: "idle"|"loading"|"ready"|"error", payload, text, schedule,
 *           rebuilt, error, retry }.
 */
export function useCanonicalPayload({ brandId, postId, version, enabled }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const key = `${brandId}|${postId}|${version}|${attempt}`;

  useEffect(() => {
    if (!enabled || !brandId || !postId) return undefined;
    const controller = new AbortController();
    fetch(`/api/brands/${brandId}/published-posts/${postId}/payload`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        let body = null;
        try {
          body = await res.json();
        } catch {
          // non-JSON error page
        }
        if (!res.ok || !body || typeof body.payload !== "object" || body.payload === null) {
          throw new Error(body?.error || `Could not load the payload from the server (HTTP ${res.status}).`);
        }
        setResult({
          key,
          status: "ready",
          payload: body.payload,
          text: JSON.stringify(body.payload, null, 2),
          schedule: body.schedule || null,
          rebuilt: Boolean(body.rebuilt),
          error: null,
        });
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setResult({ key, status: "error", error: err?.message || "Could not load the payload from the server." });
      });
    return () => controller.abort();
  }, [enabled, brandId, postId, key]);

  const retry = () => setAttempt((a) => a + 1);
  if (!enabled) return { status: "idle", retry };
  // A snapshot for an older version/attempt is never shown as current.
  if (!result || result.key !== key) return { status: "loading", retry };
  return { ...result, retry };
}
