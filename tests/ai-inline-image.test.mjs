// lib/ai: in-memory reference images reach the OpenAI request as a vision part,
// alongside the unchanged text prompt; disk-path images keep working; no-image
// calls still send a plain string. The OpenAI SDK is mocked — no network.

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let requests;
let fileReads;

mock.module("openai", {
  defaultExport: class FakeOpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: async (args) => {
            requests.push(args);
            return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} };
          },
        },
      };
    }
  },
});
mock.module("fs", {
  exports: {
    readFileSync: (p) => {
      fileReads.push(String(p));
      return Buffer.from("disk-bytes");
    },
  },
});
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      promptTemplate: {
        findUnique: async () => ({ slug: "t", name: "T", templateText: "Template body", outputType: "text" }),
      },
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    },
  },
});

const { generateWithPromptTemplate } = await import("@/lib/ai");

beforeEach(() => {
  requests = [];
  fileReads = [];
});

test("in-memory image → image_url data URI with the exact bytes, no disk read", async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await generateWithPromptTemplate({
    templateSlug: "t",
    userInput: "REFERENCE FRAME block",
    images: [{ data: bytes, mediaType: "image/png" }],
  });
  const content = requests[0].messages[0].content;
  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /Template body[\s\S]*REFERENCE FRAME block/);
  assert.equal(content[1].type, "image_url");
  assert.equal(content[1].image_url.url, `data:image/png;base64,${bytes.toString("base64")}`);
  assert.deepEqual(fileReads, []);
});

test("disk-path images (existing reference-image analysis flow) unchanged", async () => {
  await generateWithPromptTemplate({ templateSlug: "t", images: [{ filePath: "/uploads/x.jpg", mediaType: "image/jpeg" }] });
  assert.equal(fileReads.length, 1);
  assert.match(fileReads[0], /public\/uploads\/x\.jpg$/);
  assert.equal(requests[0].messages[0].content[1].image_url.url, `data:image/jpeg;base64,${Buffer.from("disk-bytes").toString("base64")}`);
});

test("no images → plain string content (original text-only request)", async () => {
  await generateWithPromptTemplate({ templateSlug: "t", userInput: "hello" });
  assert.equal(typeof requests[0].messages[0].content, "string");
});
