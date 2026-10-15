// generateWithPromptTemplate must surface a provider timeout as AI_TIMEOUT at
// once. Retrying it as a "connection error" turned one slow call into minutes
// of silence (SDK retries x our retries x the full timeout each time).
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = { creates: 0, ctorOpts: [], mode: "timeout" };

class APIConnectionError extends Error { constructor(m = "Connection error.") { super(m); this.name = "APIConnectionError"; } }
class APIConnectionTimeoutError extends APIConnectionError { constructor() { super("Request timed out."); this.name = "APIConnectionTimeoutError"; } }

class FakeOpenAI {
  constructor(opts) {
    state.ctorOpts.push(opts);
    this.chat = {
      completions: {
        create: async () => {
          state.creates++;
          if (state.mode === "timeout") throw new APIConnectionTimeoutError();
          return {
            model: "gpt-4o",
            usage: { total_tokens: 10, completion_tokens: 5 },
            choices: [{ finish_reason: "stop", message: { content: '{"posts":[{"hookTitle":"سلام ۱۲۳"}]}' } }],
          };
        },
      },
    };
  }
}
FakeOpenAI.APIConnectionError = APIConnectionError;
FakeOpenAI.APIConnectionTimeoutError = APIConnectionTimeoutError;

mock.module("openai", { defaultExport: FakeOpenAI });
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      promptTemplate: { findUnique: async () => ({ slug: "t", name: "T", outputType: "json", templateText: "Write JSON for {{brandName}}" }) },
      settings: { findUnique: async () => ({ value: "sk-test" }) },
    },
  },
});

const { generateWithPromptTemplate } = await import("../lib/ai.js");

test("a provider timeout throws AI_TIMEOUT after a single attempt", async () => {
  state.creates = 0; state.ctorOpts = []; state.mode = "timeout";
  await assert.rejects(
    generateWithPromptTemplate({ templateSlug: "t", variables: { brandName: "x" }, timeoutMs: 1234, maxRetries: 0 }),
    (err) => err.code === "AI_TIMEOUT"
  );
  assert.equal(state.creates, 1);
  assert.equal(state.ctorOpts[0].timeout, 1234);
  assert.equal(state.ctorOpts[0].maxRetries, 0);
});

test("defaults are unchanged for other callers, and Persian JSON parses intact", async () => {
  state.creates = 0; state.ctorOpts = []; state.mode = "ok";
  const r = await generateWithPromptTemplate({ templateSlug: "t", variables: { brandName: "x" } });
  assert.equal(state.ctorOpts[0].timeout, 120000);
  assert.equal("maxRetries" in state.ctorOpts[0], false);
  assert.equal(r.content.posts[0].hookTitle, "سلام ۱۲۳");
});
