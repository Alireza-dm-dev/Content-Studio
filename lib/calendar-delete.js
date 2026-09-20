/**
 * Client-side delete caller for a content calendar.
 *
 * Owns the double-submit guard so the UI only has to render a pending state:
 * a second call for an id already in flight resolves as `skipped` without
 * touching the network.
 */

import { getApiErrorMessage, parseApiResponse } from "@/lib/http";

export function createCalendarDeleter({ fetchImpl } = {}) {
  const inFlight = new Set();

  async function deleteCalendar(id) {
    if (inFlight.has(id)) return { ok: false, skipped: true, error: null };
    inFlight.add(id);
    try {
      const doFetch = fetchImpl ?? globalThis.fetch;
      const response = await doFetch(`/api/calendars/${id}`, { method: "DELETE" });
      const data = await parseApiResponse(response);
      if (!response.ok) {
        return { ok: false, skipped: false, error: getApiErrorMessage(data) };
      }
      return { ok: true, skipped: false, error: null };
    } catch (err) {
      return { ok: false, skipped: false, error: err?.message || "Failed to delete calendar." };
    } finally {
      inFlight.delete(id);
    }
  }

  deleteCalendar.isPending = (id) => inFlight.has(id);
  return deleteCalendar;
}
