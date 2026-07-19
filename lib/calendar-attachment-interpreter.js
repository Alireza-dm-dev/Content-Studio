// Server-only service for neutral AI interpretation of calendar reference attachments.
// ⚠ Do not import from client components.

import { MAX_EXTRACTED_CHARS_PER_FILE } from './calendar-attachment-utils.js';

/** Lazy import so tests with mocked generateFn never resolve the @/ prefix. */
async function defaultGenerateFn(...args) {
  const { generateWithPromptTemplate } = await import('./ai.js');
  return generateWithPromptTemplate(...args);
}

// ─── Constants ─────────────────────────────────────────────────────────────────

export const CALENDAR_ATTACHMENT_INTERPRETER_TEMPLATE_SLUG = 'calendar-reference-attachment-interpreter';

const ALLOWED_KEYS = new Set([
  'schemaVersion', 'language', 'documentType', 'summary',
  'keyFacts', 'productsOrServices', 'audiences', 'offers',
  'datesAndEvents', 'claims', 'toneAndStyle',
  'contentConstraints', 'contentOpportunities',
  'sourceLinks', 'uncertainties',
]);

const APPLICATION_KEYS = new Set([
  'monthlyObjective', 'calendarPeriod', 'targetAudience', 'platform',
  'numberOfPosts', 'selectedPosts', 'postIdeas', 'caption', 'hook',
  'callToAction', 'CalendarPost', 'brandId', 'calendarId', 'filePath', 'userId',
]);

// ─── Helper functions ──────────────────────────────────────────────────────────

function normalizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLength);
}

function normalizeArray(value, maxItems, maxItemLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const str = normalizeString(item, maxItemLength);
    if (!str) continue;
    if (seen.has(str)) continue;
    seen.add(str);
    result.push(str);
    if (result.length >= maxItems) break;
  }
  return result;
}

function extractJsonFromString(str) {
  if (typeof str !== 'string') return undefined;
  const trimmed = str.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  const firstBrace = trimmed.indexOf('{');
  if (firstBrace !== -1) {
    const lastBrace = trimmed.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
  }

  return undefined;
}

// ─── Output parsing ────────────────────────────────────────────────────────────

export function parseCalendarAttachmentInterpretationOutput(value) {
  let obj;

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    obj = value;
  } else if (typeof value === 'string') {
    obj = extractJsonFromString(value);
    if (obj === undefined) {
      return { ok: false, error: 'The document interpretation response was invalid' };
    }
  } else {
    return { ok: false, error: 'The document interpretation response was invalid' };
  }

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'The document interpretation response was invalid' };
  }

  return { ok: true, interpretation: obj };
}

// ─── Schema normalization ──────────────────────────────────────────────────────

export function normalizeCalendarAttachmentInterpretation(value) {
  const parsed = parseCalendarAttachmentInterpretationOutput(value);
  if (!parsed.ok) return parsed;

  const raw = parsed.interpretation;
  const result = {};

  // Only keep allowed keys — strip unknown and application-specific fields
  for (const key of Object.keys(raw)) {
    if (ALLOWED_KEYS.has(key) && !APPLICATION_KEYS.has(key)) {
      result[key] = raw[key];
    }
  }

  // Force schemaVersion to 1
  result.schemaVersion = 1;

  // language: required, max 80 chars, default "Unknown"
  result.language = normalizeString(raw.language, 80) || 'Unknown';

  // documentType: required, max 120 chars, default "Unknown"
  result.documentType = normalizeString(raw.documentType, 120) || 'Unknown';

  // summary: required, non-empty, max 2000 chars
  const summary = normalizeString(raw.summary, 2000);
  if (!summary) {
    return { ok: false, error: 'The document interpretation response was invalid' };
  }
  result.summary = summary;

  // Array fields: max 20 entries, max 500 chars per entry
  const arrayFields = [
    'keyFacts', 'productsOrServices', 'audiences', 'offers',
    'datesAndEvents', 'claims', 'toneAndStyle',
    'contentConstraints', 'contentOpportunities',
    'sourceLinks', 'uncertainties',
  ];

  for (const field of arrayFields) {
    result[field] = normalizeArray(raw[field], 20, 500);
  }

  return { ok: true, interpretation: result };
}

// ─── Input validation ──────────────────────────────────────────────────────────

function validateInterpretationInput({ fileName, mimeType, extractedText, extractionStatus }) {
  if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
    return { ok: false, error: 'File name is required' };
  }
  if (!mimeType || typeof mimeType !== 'string' || !mimeType.trim()) {
    return { ok: false, error: 'File MIME type is required' };
  }
  if (!extractedText || typeof extractedText !== 'string' || !extractedText.trim()) {
    return { ok: false, error: 'Extracted text is empty' };
  }
  if (extractedText.length > MAX_EXTRACTED_CHARS_PER_FILE) {
    return { ok: false, error: 'Extracted text exceeds the maximum allowed length' };
  }
  if (extractionStatus !== 'complete' && extractionStatus !== 'truncated') {
    return { ok: false, error: 'Extraction status must be "complete" or "truncated"' };
  }
  return { ok: true };
}

// ─── Main interpretation function ──────────────────────────────────────────────

export async function interpretCalendarAttachment({
  fileName,
  mimeType,
  extractedText,
  extractionStatus,
  wasTruncated,
  generateFn,
}) {
  const validation = validateInterpretationInput({ fileName, mimeType, extractedText, extractionStatus });
  if (!validation.ok) {
    return { ok: false, interpretationStatus: 'failed', error: validation.error };
  }

  const fn = generateFn || defaultGenerateFn;
  let providerResult;
  try {
    providerResult = await fn({
      templateSlug: CALENDAR_ATTACHMENT_INTERPRETER_TEMPLATE_SLUG,
      variables: {
        fileName,
        mimeType,
        documentText: extractedText,
        wasTruncated: wasTruncated ? 'yes' : 'no',
      },
      responseFormat: 'json_object',
      model: 'gpt-4o',
    });
  } catch (err) {
    return {
      ok: false,
      interpretationStatus: 'failed',
      error: 'The document interpretation response was invalid',
    };
  }

  if (!providerResult) {
    return {
      ok: false,
      interpretationStatus: 'failed',
      error: 'The document interpretation response was invalid',
    };
  }

  const rawContent = providerResult.content;
  const modelName = providerResult.model || 'unknown';

  if (!rawContent || (typeof rawContent === 'string' && !rawContent.trim())) {
    return {
      ok: false,
      interpretationStatus: 'failed',
      error: 'The document interpretation response was invalid',
    };
  }

  const normalized = normalizeCalendarAttachmentInterpretation(rawContent);
  if (!normalized.ok) {
    return {
      ok: false,
      interpretationStatus: 'failed',
      error: normalized.error,
    };
  }

  return {
    ok: true,
    interpretationStatus: 'complete',
    interpretationJson: normalized.interpretation,
    interpretationModel: modelName,
    interpretedAt: new Date().toISOString(),
  };
}
