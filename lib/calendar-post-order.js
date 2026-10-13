// Post ordering inside a saved content calendar.
//
// `CalendarPost.postNumber` IS the canonical order (every list/export sorts by
// it) and a post's identity is its DB `id`. There is no unique constraint on
// (calendarId, postNumber) — verified in dev.db — but renumbering is still done
// in two phases so a future constraint could not make a reorder collide.
//
// Pure helpers only (no Next/DB imports) so the route, the client component and
// the tests share one definition.

/** Moves the item at `from` so it ends up at index `to` (dnd-kit "arrayMove" semantics). */
export function moveItem(list, from, to) {
  const next = list.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** [{id, postNumber}] with numbers 1..N derived from the array position. */
export function numberByPosition(orderedIds) {
  return orderedIds.map((id, i) => ({ id, postNumber: i + 1 }));
}

/**
 * Validates a client-supplied order against the calendar's real post ids.
 * Returns { ok:true } or { ok:false, status, error }.
 *   400 → malformed (not an array of unique non-empty strings)
 *   422 → well-formed but not exactly this calendar's posts
 */
export function validateOrderedPostIds(existingIds, orderedPostIds) {
  if (!Array.isArray(orderedPostIds) || orderedPostIds.some(id => typeof id !== "string" || !id)) {
    return { ok: false, status: 400, error: "orderedPostIds must be an array of post IDs." };
  }
  if (new Set(orderedPostIds).size !== orderedPostIds.length) {
    return { ok: false, status: 400, error: "orderedPostIds contains duplicate post IDs." };
  }
  const existing = new Set(existingIds);
  const given = new Set(orderedPostIds);
  const foreign = orderedPostIds.filter(id => !existing.has(id));
  const missing = existingIds.filter(id => !given.has(id));
  if (foreign.length) {
    return { ok: false, status: 422, error: "orderedPostIds contains posts that do not belong to this calendar." };
  }
  if (missing.length) {
    return { ok: false, status: 422, error: "orderedPostIds is missing posts from this calendar. Reload the calendar and try again." };
  }
  return { ok: true };
}

/**
 * Renumbers a calendar's posts 1..N in `orderedPostIds` order, inside the given
 * transaction client. Phase 1 parks every post on a negative number, phase 2
 * writes the final numbers, so no intermediate state can duplicate a number.
 * Only `postNumber` is written.
 */
export async function renumberPosts(tx, calendarId, orderedPostIds) {
  for (let i = 0; i < orderedPostIds.length; i++) {
    await tx.calendarPost.update({ where: { id: orderedPostIds[i] }, data: { postNumber: -(i + 1) } });
  }
  for (let i = 0; i < orderedPostIds.length; i++) {
    await tx.calendarPost.update({ where: { id: orderedPostIds[i] }, data: { postNumber: i + 1 } });
  }
  return numberByPosition(orderedPostIds);
}

// ── Client-side helpers ───────────────────────────────────────────────────────

/** Applies [{id, postNumber}] to local posts and sorts by it (unknown posts keep their place at the end). */
export function applyOrderToPosts(posts, order) {
  const numberById = new Map(order.map(o => [o.id, o.postNumber]));
  const known = posts.filter(p => numberById.has(p.id)).map(p => ({ ...p, postNumber: numberById.get(p.id) }));
  const unknown = posts.filter(p => !numberById.has(p.id));
  known.sort((a, b) => a.postNumber - b.postNumber);
  return [...known, ...unknown];
}

/** One reorder at a time: a second request while one is in flight is skipped, never queued. */
export function createReorderGate() {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(fn) {
      if (busy) return { skipped: true };
      busy = true;
      try { return { skipped: false, value: await fn() }; }
      finally { busy = false; }
    },
  };
}

/**
 * Optimistic reorder: show the new order immediately, persist it, then keep the
 * server's authoritative order — or revert to the previous order on failure.
 *   setPosts   React state setter (accepts an updater)
 *   save       async (orderedIds) => [{id, postNumber}]  (throws on failure)
 */
export async function reorderPostsOptimistically({ posts, orderedIds, setPosts, save }) {
  const previous = posts.map(p => ({ id: p.id, postNumber: p.postNumber }));
  setPosts(cur => applyOrderToPosts(cur, numberByPosition(orderedIds)));
  try {
    const confirmed = await save(orderedIds);
    setPosts(cur => applyOrderToPosts(cur, confirmed));
    return { ok: true };
  } catch (err) {
    setPosts(cur => applyOrderToPosts(cur, previous));
    return { ok: false, error: err };
  }
}
