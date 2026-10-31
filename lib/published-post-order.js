// Single source of truth for Published Posts ordering (Instagram + LinkedIn).
//
// The publish date is PublishedPost.scheduledDate (DateTime?). Newest first;
// posts without a date come last (SQLite sorts NULLs lowest, so DESC puts them
// at the end). Ties fall back to createdAt DESC, then id DESC, so the order is
// fully deterministic. Pure module: safe to import from client components.

export const PUBLISHED_POST_ORDER_BY = [
  { scheduledDate: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

function time(value) {
  if (value == null) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// Mirrors PUBLISHED_POST_ORDER_BY for in-memory lists (e.g. inserting a post
// that was just created/edited without refetching).
export function comparePublishedPosts(a, b) {
  const sa = time(a.scheduledDate);
  const sb = time(b.scheduledDate);
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sb - sa;
  }
  const ca = time(a.createdAt) ?? 0;
  const cb = time(b.createdAt) ?? 0;
  if (ca !== cb) return cb - ca;
  return String(b.id ?? "").localeCompare(String(a.id ?? ""));
}

export function sortPublishedPosts(posts) {
  return [...posts].sort(comparePublishedPosts);
}
