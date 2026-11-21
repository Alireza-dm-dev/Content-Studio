import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";

const STATUS_CODES = {
  400: "INVALID_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
};

export function storyError(message, status, code) {
  return NextResponse.json(
    { success: false, code: code ?? STATUS_CODES[status] ?? "STORY_CONTENT_FAILED", error: message },
    { status },
  );
}

export const STORY_NOT_MIGRATED_MESSAGE =
  "Story Contents is not available because its database migration has not been applied.";

const STORY_MODELS = new Set(["BrandStoryContent", "BrandStoryAsset"]);

/**
 * True only when the error is unambiguously "the Story schema is not in this
 * database / client": a Prisma missing-table (P2021) or missing-column (P2022)
 * error on a Story model, or a Prisma client generated before the Story models
 * existed (the model delegate is undefined).
 */
export function isStorySchemaMissing(err) {
  if (!err) return false;
  if (err.code === "P2021" || err.code === "P2022") {
    const model = err.meta?.modelName;
    const table = String(err.meta?.table ?? err.meta?.driverAdapterError?.cause?.table ?? "");
    return STORY_MODELS.has(model) || /BrandStory(Content|Asset)/.test(table);
  }
  return !prisma.brandStoryContent || !prisma.brandStoryAsset;
}

/**
 * Map an unexpected error to a safe JSON response. Never returns SQL, paths,
 * stacks or Prisma messages — those go to the server log only.
 */
export function storyFailure(err, action, fallbackMessage) {
  if (isStorySchemaMissing(err)) {
    console.error(`[StoryContent] ${action} failed: Story tables missing — run \`npx prisma migrate deploy\` and \`npx prisma generate\``);
    return storyError(STORY_NOT_MIGRATED_MESSAGE, 503, "STORY_CONTENT_NOT_MIGRATED");
  }
  console.error(`[StoryContent] ${action} failed`, { code: err?.code, message: err?.message });
  return storyError(fallbackMessage, 500, "STORY_CONTENT_FAILED");
}

/** Wrap a route handler so a thrown error becomes a structured response, not a bare 500. */
export function withStoryErrors(action, fallbackMessage, handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return storyFailure(err, action, fallbackMessage);
    }
  };
}

export const STORY_DAY_INCLUDE = { assets: { orderBy: { sortOrder: "asc" } } };

/**
 * Authorize against the Story day's own brand, then require it to match the
 * brand in the URL, so a guessed id under another brand's path is a plain 404.
 */
export async function authorizeStoryDay(routeBrandId, storyId) {
  const access = await requireResourceBrandAccess("storyContent", storyId);
  if (!access.ok) return { response: storyError(access.error, access.status) };
  const story = await prisma.brandStoryContent.findUnique({
    where: { id: storyId },
    include: STORY_DAY_INCLUDE,
  });
  if (!story || story.brandId !== routeBrandId) return { response: storyError("Not found", 404) };
  return { story, user: access.user };
}
