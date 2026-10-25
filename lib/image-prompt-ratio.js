// Instagram calendar image prompts must describe only the visual content and
// design — never an aspect ratio, orientation, or pixel size. This is TEXT
// hygiene only: image-generation size settings (OpenAI / Higgsfield routes,
// previews, CSS) are untouched.

export const NO_IMAGE_RATIO_INSTRUCTION =
  "Do not mention any image ratio, aspect ratio, orientation (square, portrait, landscape), canvas shape, or pixel dimensions anywhere in the final prompt. Omit the 'Aspect ratio / format' line entirely. Describe only the visual content, composition and design.";

export function isInstagramPlatform(platform) {
  return /instagram/i.test(String(platform ?? ""));
}

const LB = "(?<![\\d:.*x×/])";
const LA = "(?![\\d:*×/]|x\\d)";
// Unmistakable image ratios — removed wherever they appear.
const STRONG_TOKEN = `${LB}(?:4[:*x×/]5|9[:*x×/]16|16[:*x×/]9|21[:*x×/]9|1\\.91:1|1[*x×]1)${LA}`;
// Ratios that also occur in business copy ("1:1 coaching") — removed only
// next to a visual-format word (see CONTEXT_BEFORE / RATIO_NOUN_STRICT).
const AMBIGUOUS_TOKEN = `${LB}(?:1:1|5:4|3:4|4:3|2:3|3:2)${LA}`;
const ANY_TOKEN = `(?:${STRONG_TOKEN}|${AMBIGUOUS_TOKEN})`;
const PIXEL_SIZE = "(?<![\\d.])\\d{3,4}\\s*[x×*]\\s*\\d{3,4}(?:\\s*(?:px|pixels?))?(?![\\d])";
const PREP = "(?:(?:in|at|with|using|on|for|as|a|an|the|با|در)\\s+)*";
const RATIO_NOUN = "(?:aspect[\\s-]*ratio|ratio|format|canvas|crop|frame|layout|dimensions?|size)";
const RATIO_NOUN_STRICT = "(?:aspect[\\s-]*ratio|ratio|format|canvas|crop|frame|layout|dimensions?|size|image|post)\\b";
const SHAPE_WORD = "(?:square|portrait|landscape|vertical|horizontal)";
const CONTEXT_BEFORE =
  "(?:aspect[\\s-]*ratio|ratio|format|canvas|output|size|dimensions?|crop|frame|orientation|square|portrait|landscape|نسبت(?:\\s+تصویر)?|ابعاد|فرمت|قالب|کادر)";
const TRAILING = `(?:\\s*\\([^)]*\\))?(?:\\s+${SHAPE_WORD})?(?:\\s+${RATIO_NOUN})?(?:\\s+(?:post|image|canvas|crop))?`;

// "- Aspect ratio / format: ..." style labelled lines go entirely.
const LINE_RULE = /^[ \t]*(?:[-*•]\s*)?(?:aspect[\s-]*ratio|image[\s-]*ratio|ratio)\b[^\n]*$/gim;

const PHRASE_RULES = [
  // Strong ratios and pixel sizes: "4:5", "1080x1080 px", "in a 9:16 vertical format"
  new RegExp(`${PREP}(?:(?:aspect[\\s-]*)?ratio\\s*[:=]?\\s*|نسبت\\s+(?:تصویر\\s+)?|ابعاد\\s+)?(?:${SHAPE_WORD}\\s+)?(?:${STRONG_TOKEN}|${PIXEL_SIZE})${TRAILING}`, "gi"),
  // Ambiguous ratios right after a format word: "aspect ratio 1:1", "format: 1:1", "square 1:1 image"
  new RegExp(`${PREP}${CONTEXT_BEFORE}\\s*[:=(/-]?\\s*(?:(?:of|is)\\s+)?(?:${SHAPE_WORD}\\s+)?${AMBIGUOUS_TOKEN}\\s*\\)?(?:\\s+${SHAPE_WORD})?(?:\\s+${RATIO_NOUN})?(?:\\s+(?:post|image|canvas|crop))?`, "gi"),
  // Ambiguous ratios right before a format word: "1:1 aspect ratio", "1:1 format"
  new RegExp(`${PREP}(?:instagram\\s+)?(?:${SHAPE_WORD}\\s+)?${AMBIGUOUS_TOKEN}(?:\\s+${SHAPE_WORD})?\\s+${RATIO_NOUN_STRICT}`, "gi"),
  // "aspect ratio of ...", "output ratio", "image ratio"
  new RegExp(`${PREP}(?:aspect|image|output|canvas|frame)[\\s-]*ratios?(?:\\s+of\\s+[^,.;\\n]+)?`, "gi"),
  // "square format / post / image ...", "portrait orientation", "landscape canvas"
  new RegExp(`${PREP}${SHAPE_WORD}[\\s-]+(?:format|post|image|canvas|crop|frame|layout|aspect|dimensions?|size|orientation|mode)\\b`, "gi"),
  /\(\s*(?:square|portrait|landscape)\s*\)/gi,
  // Persian: "فرمت مربع", "مربعی اینستاگرام"
  /(?:فرمت|قالب|ابعاد|کادر)\s+مربع(?:ی)?|مربع(?:ی)?(?=\s+(?:اینستاگرام|پست|تصویر))/g,
  // "Square Instagram image", "square feed tile"
  /\bsquare\b(?=\s+(?:instagram|ig|social|graphic|feed|slide|carousel|tile|composition)\b)/gi,
];

// A sentence whose only point is the ratio ("Use a 9:16 vertical format.") goes
// entirely; any sentence that still has content after its ratio phrase is
// removed but keeps that content (see PHRASE_RULES).
const RATIO_ONLY_MAX_WORDS_LEFT = 2;

function dropRatioOnlySentences(text) {
  return text.replace(/[^.!?\n]+[.!?]?/g, (sentence) => {
    let rest = sentence;
    for (const rule of PHRASE_RULES) rest = rest.replace(rule, " ");
    if (rest === sentence) return sentence;
    const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
    return words.length <= RATIO_ONLY_MAX_WORDS_LEFT ? "" : sentence;
  });
}

function capitalizeLine(line) {
  return line.replace(/^([ \t]*(?:[-*•]\s*)?)([a-z])/, (_, lead, ch) => lead + ch.toUpperCase());
}

export function stripImageRatioText(prompt) {
  if (typeof prompt !== "string" || !prompt) return prompt;
  const text = dropRatioOnlySentences(prompt.replace(LINE_RULE, ""));
  return text
    .split("\n")
    .map((line) => {
      let out = line;
      for (const rule of PHRASE_RULES) out = out.replace(rule, " ");
      if (out === line) return line;
      out = out
        .replace(/\(\s*\)/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+([,.;:!?،])/g, "$1")
        .replace(/([,،]\s*){2,}/g, "$1")
        .replace(/^[ \t]*[,;:،]\s*/, "")
        .replace(/[,،][ \t]*(?=[.!?]|$)/g, "")
        .replace(/[ \t]+$/g, "");
      return capitalizeLine(out.replace(/^([ \t]*)\s+/, "$1"));
    })
    .join("\n")
    .replace(/^[ \t]*[-*•][ \t]*$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
