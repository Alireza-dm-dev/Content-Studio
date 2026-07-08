// Server-only module. Do not import this file from Client Components —
// it resolves the Higgsfield API credential and configures the SDK.
import { higgsfield, config } from "@higgsfield/client/v2";
import { prisma } from "@/lib/prisma";

/**
 * resolveHiggsfieldApiKey
 *
 * Reads the Higgsfield credential from Settings (key = "HIGGSFIELD_API_KEY"),
 * falling back to process.env.HIGGSFIELD_API_KEY. Validates the result is a
 * non-placeholder "KEY_ID:KEY_SECRET" string and returns it as-is.
 *
 * Never logs the resolved credential.
 *
 * @returns {Promise<string>} the combined "KEY_ID:KEY_SECRET" credential
 */
export async function resolveHiggsfieldApiKey() {
  // 1. Check Settings table first, then fall back to env
  let apiKey = process.env.HIGGSFIELD_API_KEY;
  try {
    const setting = await prisma.settings.findUnique({ where: { key: "HIGGSFIELD_API_KEY" } });
    if (setting?.value && !setting.value.startsWith("your_")) {
      apiKey = setting.value;
    }
  } catch {
    // Settings table lookup failed; fall back to env
  }

  if (!apiKey) {
    throw new Error(
      "HIGGSFIELD_API_KEY is not configured. Add it in Settings or .env and restart the server."
    );
  }

  // 2. Trim and reject placeholder values
  const credentials = apiKey.trim();
  if (!credentials || credentials.startsWith("your_")) {
    throw new Error(
      "HIGGSFIELD_API_KEY is not configured. Add it in Settings or .env and restart the server."
    );
  }

  // 3. Validate "KEY_ID:KEY_SECRET" format — exactly one colon, both parts non-empty
  const parts = credentials.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      "HIGGSFIELD_API_KEY must be in the format KEY_ID:KEY_SECRET."
    );
  }

  return credentials;
}

/**
 * getHiggsfieldClient
 *
 * Resolves the Higgsfield credential and configures the @higgsfield/client/v2
 * SDK singleton with sensible defaults for this app. Returns the configured
 * client, ready for future subscribe() calls.
 *
 * @returns {Promise<import("@higgsfield/client/v2").HiggsfieldClient>}
 */
export async function getHiggsfieldClient() {
  const credentials = await resolveHiggsfieldApiKey();

  config({
    credentials,
    timeout: 120000,
    maxRetries: 2,
    pollInterval: 3000,
    maxPollTime: 120000,
  });

  return higgsfield;
}

/**
 * spendTokens
 *
 * Validates the requested HiggsfieldModel, then atomically deducts its
 * tokenCost from the "higgsfield" OperatorTokenBalance, creates a pending
 * GeneratedMedia row, and records a spend TokenLedgerEntry. Throws (with no
 * DB writes) if the model is missing/inactive/mismatched, and throws
 * "INSUFFICIENT_HIGGSFIELD_BALANCE" before creating any rows if the balance
 * would go negative.
 *
 * @param {object} opts
 * @param {string} opts.higgsfieldModelId
 * @param {string} opts.mediaType
 * @param {string} opts.sourcePrompt
 * @param {string} [opts.brandId]
 * @param {string} [opts.calendarPostId]
 * @param {string} [opts.generatedPromptId]
 *
 * @returns {Promise<{ generatedMedia: object, higgsfieldModel: object, tokenCost: number, balanceAfter: number }>}
 */
export async function spendTokens({
  higgsfieldModelId,
  mediaType,
  sourcePrompt,
  brandId = null,
  calendarPostId = null,
  generatedPromptId = null,
}) {
  if (!higgsfieldModelId) throw new Error("spendTokens: higgsfieldModelId is required.");
  if (!mediaType) throw new Error("spendTokens: mediaType is required.");
  if (!sourcePrompt) throw new Error("spendTokens: sourcePrompt is required.");

  // 1. Load and validate the model before touching any balances
  const higgsfieldModel = await prisma.higgsfieldModel.findUnique({
    where: { id: higgsfieldModelId },
  });

  if (!higgsfieldModel) {
    throw new Error(`spendTokens: HiggsfieldModel not found for id "${higgsfieldModelId}".`);
  }
  if (!higgsfieldModel.isActive) {
    throw new Error(`spendTokens: HiggsfieldModel "${higgsfieldModel.modelKey}" is not active.`);
  }
  if (higgsfieldModel.mediaType !== mediaType) {
    throw new Error(
      `spendTokens: HiggsfieldModel "${higgsfieldModel.modelKey}" has mediaType "${higgsfieldModel.mediaType}", expected "${mediaType}".`
    );
  }

  const tokenCost = higgsfieldModel.tokenCost;

  // 2. Atomically deduct balance, create pending GeneratedMedia, record ledger entry
  const { generatedMedia, newBalance } = await prisma.$transaction(async (tx) => {
    const currentBalance = await tx.operatorTokenBalance.upsert({
      where: { provider: "higgsfield" },
      update: {},
      create: { provider: "higgsfield", balance: 0 },
    });

    const newBalance = currentBalance.balance - tokenCost;
    if (newBalance < 0) {
      throw new Error("INSUFFICIENT_HIGGSFIELD_BALANCE");
    }

    await tx.operatorTokenBalance.update({
      where: { provider: "higgsfield" },
      data: { balance: newBalance },
    });

    const generatedMedia = await tx.generatedMedia.create({
      data: {
        status: "pending",
        mediaType,
        sourcePrompt,
        tokenCost,
        higgsfieldModelId,
        brandId,
        calendarPostId,
        generatedPromptId,
      },
    });

    await tx.tokenLedgerEntry.create({
      data: {
        provider: "higgsfield",
        delta: -tokenCost,
        reason: "higgsfield_generation_spend",
        balanceAfter: newBalance,
        higgsfieldModelId,
        generatedMediaId: generatedMedia.id,
      },
    });

    return { generatedMedia, newBalance };
  });

  return { generatedMedia, higgsfieldModel, tokenCost, balanceAfter: newBalance };
}

/**
 * refundTokens
 *
 * Atomically refunds a pending GeneratedMedia's tokenCost back to the
 * "higgsfield" OperatorTokenBalance, marks the row "failed" with
 * errorMessage, and records a refund TokenLedgerEntry. Safe against
 * double-refunds: throws if the row is already "completed" or "failed".
 *
 * @param {object} opts
 * @param {string} opts.generatedMediaId
 * @param {string} opts.errorMessage
 *
 * @returns {Promise<{ generatedMedia: object, balanceAfter: number }>}
 */
export async function refundTokens({ generatedMediaId, errorMessage }) {
  if (!generatedMediaId) throw new Error("refundTokens: generatedMediaId is required.");

  const existing = await prisma.generatedMedia.findUnique({
    where: { id: generatedMediaId },
    include: { higgsfieldModel: true },
  });

  if (!existing) {
    throw new Error(`refundTokens: GeneratedMedia not found for id "${generatedMediaId}".`);
  }
  if (existing.status === "completed") {
    throw new Error("refundTokens: GeneratedMedia is already completed; cannot refund.");
  }
  if (existing.status === "failed") {
    throw new Error("refundTokens: GeneratedMedia is already failed; refund already processed.");
  }
  if (existing.tokenCost == null) {
    throw new Error("refundTokens: GeneratedMedia has no tokenCost to refund.");
  }

  const tokenCost = existing.tokenCost;
  const safeErrorMessage =
    (errorMessage ?? "").toString().trim().slice(0, 1000) || "Generation failed.";

  const { generatedMedia, newBalance } = await prisma.$transaction(async (tx) => {
    const currentBalance = await tx.operatorTokenBalance.upsert({
      where: { provider: "higgsfield" },
      update: {},
      create: { provider: "higgsfield", balance: 0 },
    });

    const newBalance = currentBalance.balance + tokenCost;

    await tx.operatorTokenBalance.update({
      where: { provider: "higgsfield" },
      data: { balance: newBalance },
    });

    const generatedMedia = await tx.generatedMedia.update({
      where: { id: generatedMediaId },
      data: {
        status: "failed",
        errorMessage: safeErrorMessage,
      },
    });

    await tx.tokenLedgerEntry.create({
      data: {
        provider: "higgsfield",
        delta: tokenCost,
        reason: "higgsfield_generation_refund",
        balanceAfter: newBalance,
        higgsfieldModelId: existing.higgsfieldModelId,
        generatedMediaId,
      },
    });

    return { generatedMedia, newBalance };
  });

  return { generatedMedia, balanceAfter: newBalance };
}

/**
 * completeGeneratedMedia
 *
 * Marks a GeneratedMedia row "completed" with its remote output URL (and
 * external job id, if available). Does not touch the token balance and
 * does not create a TokenLedgerEntry.
 *
 * @param {object} opts
 * @param {string} opts.generatedMediaId
 * @param {string} opts.remoteUrl
 * @param {string} [opts.externalJobId]
 *
 * @returns {Promise<object>} the updated GeneratedMedia row
 */
export async function completeGeneratedMedia({ generatedMediaId, remoteUrl, externalJobId }) {
  if (!generatedMediaId) throw new Error("completeGeneratedMedia: generatedMediaId is required.");
  if (!remoteUrl) throw new Error("completeGeneratedMedia: remoteUrl is required.");

  return prisma.generatedMedia.update({
    where: { id: generatedMediaId },
    data: {
      status: "completed",
      remoteUrl,
      ...(externalJobId ? { externalJobId } : {}),
      errorMessage: null,
    },
  });
}

// ── Higgsfield response helpers ─────────────────────────────────────────────
// Real responses for arbitrary endpoints aren't fully typed by the SDK, so
// these check the documented shapes plus a few likely alternates.

function extractHiggsfieldResultUrl(jobSet) {
  const url =
    jobSet?.jobs?.[0]?.results?.raw?.url ??
    jobSet?.jobs?.[0]?.results?.url ??
    jobSet?.images?.[0]?.url ??
    jobSet?.image?.url ??
    jobSet?.video?.url ??
    jobSet?.url;

  if (!url) {
    throw new Error("Higgsfield generation completed but no output URL was found.");
  }

  return url;
}

function extractHiggsfieldExternalJobId(jobSet) {
  return jobSet?.request_id ?? jobSet?.id ?? jobSet?.jobs?.[0]?.id ?? null;
}

/**
 * generateImage
 *
 * Calls the Higgsfield SDK's subscribe() for a text-to-image endpoint and
 * waits for completion via polling. Does not touch token balances or
 * GeneratedMedia rows — the caller (a future API route) is responsible for
 * spendTokens() / refundTokens() / completeGeneratedMedia().
 *
 * @param {object} opts
 * @param {string} opts.modelKey - SDK endpoint, e.g. "flux-pro/kontext/max/text-to-image"
 * @param {string} opts.prompt
 * @param {string} [opts.aspectRatio] - defaults to "9:16"
 * @param {number} [opts.safetyTolerance] - defaults to 2
 * @param {number} [opts.seed] - optional; omitted from input if not provided
 *
 * @returns {Promise<{ remoteUrl: string, externalJobId: string|null, rawResponse: object }>}
 */
export async function generateImage({ modelKey, prompt, aspectRatio, safetyTolerance, seed }) {
  if (!modelKey) throw new Error("generateImage: modelKey is required.");
  if (!prompt) throw new Error("generateImage: prompt is required.");

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) throw new Error("generateImage: prompt must not be empty.");

  const input = {
    aspect_ratio: aspectRatio ?? "9:16",
    prompt: trimmedPrompt,
    safety_tolerance: safetyTolerance ?? 2,
    ...(seed !== undefined && seed !== null ? { seed } : {}),
  };

  const client = await getHiggsfieldClient();
  const jobSet = await client.subscribe(modelKey, { input, withPolling: true });

  const remoteUrl = extractHiggsfieldResultUrl(jobSet);
  const externalJobId = extractHiggsfieldExternalJobId(jobSet);

  return { remoteUrl, externalJobId, rawResponse: jobSet };
}
