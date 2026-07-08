/**
 * Extract all {{variable}} placeholder names from a template string.
 * Returns a deduplicated array of variable names.
 */
export function extractVariables(text) {
  if (!text) return [];
  const matches = [...text.matchAll(/\{\{(\w+)\}\}/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

/**
 * Replace {{variable}} placeholders with values from the variables object.
 * Missing variables are left as-is.
 */
export function interpolateTemplate(templateText, variables = {}) {
  let result = templateText;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return result;
}

/**
 * Return true if the template text is still a placeholder (starts with //).
 */
export function isPlaceholder(templateText) {
  return templateText?.trimStart().startsWith("//") ?? true;
}
