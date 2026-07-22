import OpenAI from "openai";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { interpolateTemplate, extractVariables, isPlaceholder } from "@/lib/template-utils";

/**
 * generateWithPromptTemplate
 *
 * @param {object}   opts
 * @param {string}   opts.templateSlug   - slug of the PromptTemplate record
 * @param {object}   opts.variables      - key/value map for {{placeholders}}
 * @param {string}   opts.responseFormat - "auto" | "text" | "json_object"
 * @param {string}   opts.model          - OpenAI model id (default gpt-4o)
 * @param {number}   opts.maxTokens      - max output tokens (undefined = model default; set explicitly for large outputs)
 * @param {Array}    opts.images         - [{ filePath: string, mediaType: string }]
 * @param {string}   opts.userInput      - appended after the template text
 *
 * @returns {{ content, raw, prompt, usage, model, template, unreplacedVariables }}
 */
export async function generateWithPromptTemplate({
  templateSlug,
  variables = {},
  responseFormat = "auto",
  model = "gpt-4o",
  maxTokens = undefined,
  images = [],
  userInput = null,
}) {
  // 1. Load template from DB
  const template = await prisma.promptTemplate.findUnique({
    where: { slug: templateSlug },
  });

  if (!template) {
    throw new Error(`Prompt template not found: "${templateSlug}"`);
  }

  // 2. Guard against placeholder text
  if (isPlaceholder(template.templateText)) {
    throw new Error(
      `Template "${template.name}" still has placeholder text. ` +
        `Open the Prompt Library and paste your real prompt first.`
    );
  }

  // 3. Replace {{variable}} placeholders
  let prompt = interpolateTemplate(template.templateText, variables);

  // 3b. Append userInput after the template
  if (userInput && userInput.trim()) {
    prompt = `${prompt}\n\n---\n\n${userInput.trim()}`;
  }

  const unreplacedVariables = extractVariables(prompt);

  // 4. Validate API key — check Settings table first, then env
  let apiKey = process.env.OPENAI_API_KEY;
  try {
    const setting = await prisma.settings.findUnique({ where: { key: "OPENAI_API_KEY" } });
    if (setting?.value && !setting.value.startsWith("your_")) {
      apiKey = setting.value;
    }
  } catch {
    // Settings table lookup failed; fall back to env
  }
  if (!apiKey || apiKey.startsWith("your_")) {
    const err = new Error(
      "OPENAI_API_KEY is not configured. Add it in Settings or .env and restart the server."
    );
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }

  // 5. Resolve response format
  const useJson =
    responseFormat === "json_object" ||
    (responseFormat === "auto" &&
      (template.outputType === "json" || template.outputType === "storyboard"));

  // 5b. OpenAI JSON mode requires the word "json" somewhere in the prompt
  let finalPrompt = prompt;
  if (useJson && !prompt.toLowerCase().includes("json")) {
    finalPrompt = prompt + "\n\nRespond with valid JSON.";
  }

  console.log(
    `[AI] slug=${templateSlug} | model=${model} | json=${useJson} | maxTokens=${maxTokens} | promptChars=${finalPrompt.length}`
  );

  // 6. Build message content (text or vision)
  let messageContent;
  if (images.length > 0) {
    const imageParts = images.map(({ filePath, mediaType }) => {
      const absPath = path.join(process.cwd(), "public", filePath);
      const base64 = readFileSync(absPath).toString("base64");
      return {
        type: "image_url",
        image_url: { url: `data:${mediaType || "image/jpeg"};base64,${base64}` },
      };
    });
    messageContent = [{ type: "text", text: finalPrompt }, ...imageParts];
  } else {
    messageContent = finalPrompt;
  }

  // 7. Call OpenAI — retry on transient connection failures.
  // The SDK already retries connection errors internally (default 2 attempts)
  // before giving up with the generic "Connection error.", but a calendar
  // generation call is slow and expensive to redo from scratch, so a brief
  // network blip (wifi drop, sleep/wake, VPN reconnect) is worth a couple more
  // attempts with backoff rather than failing the whole request outright.
  const openai = new OpenAI({ apiKey, timeout: 120000 });
  const CONNECTION_RETRY_DELAYS_MS = [2000, 5000, 10000];

  let completion;
  for (let attempt = 0; ; attempt++) {
    try {
      completion = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: messageContent }],
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...(useJson ? { response_format: { type: "json_object" } } : {}),
      });
      break;
    } catch (err) {
      const isConnectionError =
        err instanceof OpenAI.APIConnectionError || err?.name === "APIConnectionError";

      if (!isConnectionError || attempt >= CONNECTION_RETRY_DELAYS_MS.length) {
        if (isConnectionError) {
          console.error(
            `[AI] Connection attempts exhausted. ` +
            `name=${err?.name} | message=${err?.message} | code=${err?.code ?? "none"} | ` +
            `status=${err?.status ?? "none"} | cause=${err?.cause?.message ?? "none"}`
          );
          // Replace the SDK's generic "Connection error." with something a
          // user can act on — this is a network/connectivity problem, not an
          // issue with their inputs or the prompt.
          const friendly = new Error(
            "Couldn't reach the AI service (OpenAI). This is usually a temporary network issue — please try again in a moment."
          );
          friendly.code = "AI_CONNECTION_ERROR";
          friendly.cause = err;
          throw friendly;
        }
        throw err;
      }

      const delay = CONNECTION_RETRY_DELAYS_MS[attempt];
      console.warn(
        `[AI] Connection error reaching OpenAI (attempt ${attempt + 1}/${CONNECTION_RETRY_DELAYS_MS.length + 1}). Retrying in ${delay}ms…`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // 8a. Guard: missing choices
  if (!completion.choices?.length || !completion.choices[0]) {
    console.error(
      `[AI] ERROR: No choices returned. model=${completion.model} | tokens=${completion.usage?.total_tokens}`
    );
    throw new Error(
      "AI returned no response choices. This may be a temporary API issue. Please try again."
    );
  }

  const choice = completion.choices[0];
  const finishReason = choice.finish_reason;
  const refusal = choice.message?.refusal;
  const raw = choice.message?.content ?? "";

  console.log(
    `[AI] finish=${finishReason} | rawChars=${raw.length} | tokens=${completion.usage?.total_tokens}`
  );

  if (finishReason === "length") {
    console.warn(
      `[AI] WARNING: Response truncated (finish_reason=length). ` +
        `Increase maxTokens or reduce the number of posts.`
    );
  }

  // 8b. Guard: content filter
  if (finishReason === "content_filter") {
    console.error(
      `[AI] ERROR: finish_reason=content_filter | model=${completion.model} | rawChars=${raw.length} | tokens=${completion.usage?.total_tokens}`
    );
    throw new Error(
      "AI response was blocked by the content filter. Please revise the inputs or reduce sensitive wording."
    );
  }

  // 8c. Guard: model refusal
  if (refusal) {
    console.error(`[AI] ERROR: Model refusal — ${refusal.slice(0, 120)}`);
    throw new Error(
      "AI refused to generate a response. Please adjust the inputs and try again."
    );
  }

  // 8d. Guard: empty response (fallback for any other reason)
  if (!raw.trim()) {
    console.error(
      `[AI] ERROR: Empty content for unknown reason | finish=${finishReason} | model=${completion.model} | tokens=${completion.usage?.total_tokens}`
    );
    throw new Error(
      "AI returned an empty response. This may be a content filter or API issue. Please try again."
    );
  }

  // 9. Parse JSON if expected
  let content = raw;
  if (useJson) {
    try {
      content = JSON.parse(raw);
    } catch {
      // Leave as raw string — caller will try to re-parse
    }
  }

  return {
    content,
    raw,
    prompt: finalPrompt,
    unreplacedVariables,
    usage: completion.usage,
    model: completion.model,
    finishReason,
    template: {
      slug: template.slug,
      name: template.name,
      outputType: template.outputType,
    },
  };
}
