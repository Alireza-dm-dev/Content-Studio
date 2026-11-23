/**
 * Instagram collaboration posts.
 *
 * A PublishedPost is owned by exactly one Brand (`brandId`, the PRIMARY brand).
 * A PublishedPostCollaborator row makes the SAME post also appear in another
 * Brand's Instagram Published Posts grid. It never copies the post.
 *
 * Policy (V1)
 * -----------
 *   - Instagram only. LinkedIn posts never have collaborators.
 *   - A collaborator must be a different Brand than the primary one, and the
 *     acting user must be able to access every collaborator Brand (re-checked
 *     here on the server; the client dropdown is never trusted).
 *   - Viewing: anyone with access to the primary Brand OR a collaborator Brand.
 *   - Managing (edit, delete, thumbnail, n8n, adapt, collaborators): only users
 *     with access to the PRIMARY Brand. A collaborator membership never grants
 *     control over another Brand's post.
 *   - Display/organisation only. The n8n payload has no collaborator field, so
 *     the actual Instagram collab invite is still done manually.
 */

import { prisma } from "@/lib/prisma";
import { canUserAccessBrand, isAdminUser, getAccessibleBrandIds } from "@/lib/brand-access";

export const COLLABORATION_PLATFORM = "Instagram";

// Content Studio cap, not an Instagram API contract.
export const MAX_COLLABORATOR_BRANDS = 3;

// Prisma `include` fragment that loads what decorateCollaboration() needs.
// Only id + name are selected (plus the primary brand's timezone, which is the
// zone the post's schedule is edited in), never other Brand fields.
export const COLLABORATION_INCLUDE = {
  brand: { select: { id: true, name: true, timezone: true } },
  collaborators: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { brandId: true, brand: { select: { id: true, name: true } } },
  },
};

/**
 * `where` for a Brand's Published Posts grid.
 *
 * Instagram: the Brand's own posts plus Instagram posts it collaborates on.
 * LinkedIn: unchanged (own posts only).
 * No platform: own posts of any platform plus Instagram collaborations.
 *
 * This is a single query over PublishedPost, so a post is returned at most once
 * and the caller's orderBy (scheduledDate, createdAt, id) applies unchanged.
 */
export function publishedPostGridWhere(brandId, platform = null) {
  const collaboration = {
    platform: COLLABORATION_PLATFORM,
    collaborators: { some: { brandId } },
  };
  if (platform === COLLABORATION_PLATFORM) {
    return { OR: [{ brandId, platform }, collaboration] };
  }
  if (platform) {
    return { brandId, platform };
  }
  return { OR: [{ brandId }, collaboration] };
}

// Local media of a Published Post: /uploads/<ownerBrandId>/published-posts/<postId>/<file>
const POST_UPLOAD_PATH = /^\/uploads\/([A-Za-z0-9_-]+)\/published-posts\/([A-Za-z0-9_-]+)\/[^/]+$/;

/**
 * Media authorization for collaboration posts, mirroring the VIEW rule above:
 * a user who can see an Instagram post only through a collaborator Brand may
 * also load that one post's local media files. Nothing else under the owning
 * Brand's uploads is opened. Any doubt (bad path, unknown post, not Instagram,
 * no accessible collaborator row, DB error) → false.
 */
export async function canViewCollaborationUpload(user, pathname) {
  try {
    if (!user) return false;
    const m = POST_UPLOAD_PATH.exec(String(pathname || ""));
    if (!m) return false;
    const [, ownerBrandId, postId] = m;
    const accessible = await getAccessibleBrandIds(user);
    if (accessible === null) return true; // admin: already allowed by brand access
    if (!accessible.length) return false;
    const post = await prisma.publishedPost.findFirst({
      where: { id: postId, brandId: ownerBrandId, platform: COLLABORATION_PLATFORM },
      select: { id: true },
    });
    if (!post) return false;
    const collaborator = await prisma.publishedPostCollaborator.findFirst({
      where: { publishedPostId: postId, brandId: { in: accessible } },
      select: { id: true },
    });
    return Boolean(collaborator);
  } catch {
    return false;
  }
}

/**
 * `where` for reading ONE post through a Brand's URL: primary or collaborator.
 * Mutation routes must NOT use this; they stay on `{ id, brandId }`.
 */
export function viewablePublishedPostWhere(brandId, postId) {
  return { id: postId, ...publishedPostGridWhere(brandId) };
}

/**
 * True when `brandId` is only a collaborator on this post (not its owner).
 * Used to answer 403 instead of 404 when a collaborator brand tries to manage.
 */
export async function isCollaboratorOnlyPost(brandId, postId) {
  if (!brandId || !postId) return false;
  const row = await prisma.publishedPostCollaborator.findFirst({
    where: { publishedPostId: postId, brandId },
    select: { id: true },
  });
  return Boolean(row);
}

export const COLLABORATOR_MANAGE_FORBIDDEN =
  "This is a collaboration post owned by another brand. Only users with access to its primary brand can change it.";

/**
 * Normalise client input into a de-duplicated list of brand ids.
 * Accepts an array (JSON) or the result of formData.getAll(). Empty strings are
 * dropped so an empty <select> value means "no collaborator".
 */
export function parseCollaboratorBrandIds(raw) {
  if (raw == null) return { ok: true, ids: [] };
  const list = Array.isArray(raw) ? raw : [raw];
  const ids = [];
  for (const value of list) {
    if (typeof value !== "string") {
      return { ok: false, status: 400, error: "Collaborator brand ids must be strings." };
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!ids.includes(trimmed)) ids.push(trimmed);
  }
  if (ids.length > MAX_COLLABORATOR_BRANDS) {
    return {
      ok: false,
      status: 400,
      error: `A post can have at most ${MAX_COLLABORATOR_BRANDS} collaborator brands.`,
    };
  }
  return { ok: true, ids };
}

/**
 * Server-side authorization for a collaborator list.
 * Returns { ok: true, brands: [{ id, name }] } in the requested order, or
 * { ok: false, status, error } without naming any brand the user cannot see.
 *
 * `alreadyLinkedIds` (edit only): collaborators the post already has. Keeping
 * one of those is not a new assignment, so it skips the access check; this
 * lets a primary-brand editor keep or remove a collaborator that someone else
 * (with broader access) added. Every NEWLY added brand must be accessible.
 */
export async function validateCollaboratorBrands({
  user,
  primaryBrandId,
  platform,
  brandIds,
  alreadyLinkedIds = [],
}) {
  const ids = brandIds || [];
  if (ids.length === 0) return { ok: true, brands: [] };

  if (platform !== COLLABORATION_PLATFORM) {
    return { ok: false, status: 400, error: "Collaboration is only available for Instagram posts." };
  }
  if (ids.includes(primaryBrandId)) {
    return {
      ok: false,
      status: 400,
      error: "A collaborator brand must be different from the post's own brand.",
    };
  }

  // Access first, so a non-admin cannot probe which brand ids exist.
  for (const brandId of ids) {
    if (alreadyLinkedIds.includes(brandId)) continue;
    if (!(await canUserAccessBrand(user, brandId))) {
      return {
        ok: false,
        status: 403,
        error: "You do not have access to one or more selected collaborator brands.",
      };
    }
  }

  const rows = await prisma.brand.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const byId = new Map(rows.map((b) => [b.id, b]));
  if (ids.some((id) => !byId.has(id))) {
    // Only reachable for admins (or a membership pointing at a vanished brand).
    return isAdminUser(user)
      ? { ok: false, status: 400, error: "Collaborator brand not found." }
      : {
          ok: false,
          status: 403,
          error: "You do not have access to one or more selected collaborator brands.",
        };
  }
  return { ok: true, brands: ids.map((id) => byId.get(id)) };
}

/**
 * Replace a post's collaborator set. Only touches PublishedPostCollaborator
 * rows: never the post, its primary brand, or its media.
 */
export async function replacePublishedPostCollaborators(client, postId, brandIds) {
  await client.publishedPostCollaborator.deleteMany({
    where: { publishedPostId: postId, brandId: { notIn: brandIds } },
  });
  const existing = await client.publishedPostCollaborator.findMany({
    where: { publishedPostId: postId },
    select: { brandId: true },
  });
  const have = new Set(existing.map((r) => r.brandId));
  for (const brandId of brandIds) {
    if (have.has(brandId)) continue;
    await client.publishedPostCollaborator.create({
      data: { publishedPostId: postId, brandId },
    });
  }
}

/**
 * Add collaboration fields to an already-serialized post and strip the raw
 * relation objects. `raw` is the Prisma row loaded with COLLABORATION_INCLUDE.
 *
 *   isCollaboration     true when the post has at least one collaborator
 *   primaryBrand        { id, name, timezone } of the owning brand
 *   collaboratorBrands  [{ id, name }]
 *   viewerRelation      "primary" | "collaborator", relative to viewerBrandId
 *   canManage           whether the current user may edit/delete it
 *
 * `accessibleBrandIds` is the result of getAccessibleBrandIds(user): null means
 * admin (unrestricted).
 */
export function decorateCollaboration(serialized, raw, { viewerBrandId, accessibleBrandIds }) {
  if (!serialized) return serialized;
  const { brand: _brand, collaborators: _collaborators, ...rest } = serialized;

  const isInstagram = rest.platform === COLLABORATION_PLATFORM;
  const collaboratorBrands = isInstagram
    ? (raw?.collaborators || [])
        .map((c) => (c.brand ? { id: c.brand.id, name: c.brand.name } : null))
        .filter(Boolean)
    : [];
  const primaryBrand = raw?.brand
    ? { id: raw.brand.id, name: raw.brand.name, timezone: raw.brand.timezone ?? null }
    : { id: rest.brandId, name: null, timezone: null };

  const canManage =
    accessibleBrandIds === null || (accessibleBrandIds || []).includes(rest.brandId);

  return {
    ...rest,
    isCollaboration: collaboratorBrands.length > 0,
    primaryBrand,
    collaboratorBrands,
    viewerRelation: viewerBrandId && viewerBrandId !== rest.brandId ? "collaborator" : "primary",
    canManage,
  };
}
