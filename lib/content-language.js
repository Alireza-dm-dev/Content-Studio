export const DEFAULT_CONTENT_LANGUAGE = "en";

export const CONTENT_LANGUAGES = [
  { code: "en", label: "English", direction: "ltr" },
  { code: "fa", label: "Persian / فارسی", direction: "rtl" },
  { code: "ar", label: "Arabic / العربية", direction: "rtl" },
  { code: "fr", label: "French", direction: "ltr" },
  { code: "es", label: "Spanish", direction: "ltr" },
  { code: "de", label: "German", direction: "ltr" },
  { code: "nl", label: "Dutch", direction: "ltr" },
];

const _CODE_SET = new Set(CONTENT_LANGUAGES.map(l => l.code));

const _CODE_MAP = Object.fromEntries(
  CONTENT_LANGUAGES.map(l => [l.code, l])
);

const _KNOWN_LOCALES = {
  "fa-ir": "fa", "fa-af": "fa",
  "ar-sa": "ar", "ar-ae": "ar", "ar-eg": "ar", "ar-iq": "ar", "ar-sy": "ar",
  "fr-fr": "fr", "fr-ca": "fr", "fr-be": "fr", "fr-ch": "fr",
  "es-es": "es", "es-mx": "es", "es-ar": "es",
  "de-de": "de", "de-at": "de", "de-ch": "de",
  "nl-nl": "nl", "nl-be": "nl",
};

export function normalizeLanguageCode(code) {
  if (!code || typeof code !== "string") return DEFAULT_CONTENT_LANGUAGE;
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) return DEFAULT_CONTENT_LANGUAGE;
  if (_CODE_SET.has(trimmed)) return trimmed;
  const mapped = _KNOWN_LOCALES[trimmed];
  if (mapped) return mapped;
  return DEFAULT_CONTENT_LANGUAGE;
}

export function isSupportedLanguageCode(code) {
  if (!code || typeof code !== "string") return false;
  return _CODE_SET.has(code.trim().toLowerCase());
}

export function getLanguageInfo(code) {
  const c = normalizeLanguageCode(code);
  const entry = _CODE_MAP[c];
  return { code: c, label: entry.label, direction: entry.direction };
}

export function getTextDirection(code) {
  return getLanguageInfo(code).direction;
}

export function isRtlLanguage(code) {
  return getTextDirection(code) === "rtl";
}

const LANGUAGE_NAMES = Object.fromEntries(
  CONTENT_LANGUAGES.map(l => [l.code, l.label])
);

export function buildLanguageInstruction(code) {
  const c = normalizeLanguageCode(code);
  const name = LANGUAGE_NAMES[c] || "English";
  return [
    "=== AUTHORITATIVE OUTPUT LANGUAGE ===",
    `Output language: ${name} (${c}).`,
    `Write every user-facing natural-language field in ${name}.`,
    `Do not mix other languages into hooks, titles, angles, messages, captions,`,
    `hashtags, image text, carousel text, narration, dialogue, visual directions,`,
    `or generated prompts unless required for a proper name, Brand name, URL,`,
    `social handle, technical abbreviation, product name, or exact quotation.`,
    `Keep internal platform, format, status, scope, date, ID, and URL values`,
    `canonical and unchanged.`,
    `This language requirement overrides language inferred from source material,`,
    `uploaded references, examples, previous output, or the user interface.`,
  ].join("\n");
}
