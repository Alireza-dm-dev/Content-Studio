"use client";

import { useEffect, useState } from "react";
import { serverScheduleFor } from "@/lib/timezone";

/**
 * Authoritative Brand-local schedule for a SAVED post shown in a detail modal.
 *
 * Uses the server-built `post.schedule`. When a scheduled post arrives without a
 * matching one, the post is refetched from the server (GET single post) instead
 * of converting in the browser. Until/unless that succeeds, the state is
 * "loading" / "unavailable" — distinct from an explicitly unscheduled post.
 *
 * Returns { state: "unscheduled"|"ready"|"loading"|"unavailable", schedule }.
 */
export function useServerSchedule(post, brandId) {
  const direct = serverScheduleFor(post);
  const scheduled = Boolean(post?.scheduledDate) && !isNaN(new Date(post.scheduledDate).getTime());
  const key = scheduled && !direct && brandId && post?.id ? `${brandId}|${post.id}|${post.scheduledDate}` : null;
  const [fetched, setFetched] = useState(null);

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    fetch(`/api/brands/${brandId}/published-posts/${post.id}`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        // Accept only a schedule that describes THIS post's instant.
        const schedule = body ? serverScheduleFor({ scheduledDate: post.scheduledDate, schedule: body.schedule }) : null;
        setFetched({ key, schedule });
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setFetched({ key, schedule: null });
      });
    return () => controller.abort();
    // post.id / post.scheduledDate are part of `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, brandId]);

  if (!scheduled) return { state: "unscheduled", schedule: null };
  if (direct) return { state: "ready", schedule: direct };
  if (!key || (fetched && fetched.key === key && !fetched.schedule)) return { state: "unavailable", schedule: null };
  if (fetched && fetched.key === key) return { state: "ready", schedule: fetched.schedule };
  return { state: "loading", schedule: null };
}

export const SCHEDULE_UNAVAILABLE_TEXT = "Publishing time unavailable";
