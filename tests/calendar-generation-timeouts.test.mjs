// Timeout budget, keep-alive response, client error classification, and the
// Persian ZWNJ hashtag fix used by calendar generation.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CALENDAR_PROVIDER_TIMEOUT_MS,
  CALENDAR_MIN_ATTEMPT_MS,
  getCalendarGenerationBudgetMs,
  getCalendarClientTimeoutMs,
  getProviderTimeoutForAttempt,
} from "../lib/calendar-generation-budget.js";
import { respondWithHeartbeat } from "../lib/heartbeat-json-response.js";
import {
  getCalendarGenerationFailureMessage,
  CALENDAR_TIMEOUT_MESSAGE,
  CALENDAR_NETWORK_MESSAGE,
} from "../lib/calendar-generation-errors.js";
import {
  mergeHashtagsIntoCaption,
  buildFallbackOutputImageTextRequirements,
  formatOutputImageTextRequirementsForDisplay,
  validateOutputImageTextRequirements,
  parseSlideCountFromContentStructure,
} from "../lib/calendar-post-utils.js";

test("timeout layers nest: provider < route deadline < client, for every post count", () => {
  for (let n = 1; n <= 60; n++) {
    const route = getCalendarGenerationBudgetMs(n);
    const client = getCalendarClientTimeoutMs(n);
    assert.ok(CALENDAR_PROVIDER_TIMEOUT_MS < route, `n=${n}`);
    assert.ok(route < client, `n=${n}`);
  }
  // Measured Persian 12-post generation took ~75s; the budget must clear it comfortably.
  assert.ok(getCalendarGenerationBudgetMs(12) >= 3 * 75_000);
  assert.ok(getCalendarGenerationBudgetMs(60) <= 600_000);
});

test("no provider attempt starts once the remaining budget is too small", () => {
  const now = 1_000_000;
  assert.equal(getProviderTimeoutForAttempt(now + 10 * 60_000, now), CALENDAR_PROVIDER_TIMEOUT_MS);
  const t = getProviderTimeoutForAttempt(now + 40_000, now);
  assert.ok(t >= CALENDAR_MIN_ATTEMPT_MS && t < 40_000);
  assert.equal(getProviderTimeoutForAttempt(now + 15_000, now), null);
});

test("a fast result is returned untouched, real status preserved", async () => {
  const res = await respondWithHeartbeat(
    Promise.resolve(Response.json({ success: false, error: "nope" }, { status: 422 })),
    { startAfterMs: 1000 }
  );
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { success: false, error: "nope" });
});

test("a slow result streams keep-alive bytes first, then parseable JSON", async () => {
  let finish;
  const work = new Promise((r) => { finish = r; });
  const res = await respondWithHeartbeat(work, { startAfterMs: 10, intervalMs: 10 });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /no-transform/);

  const reader = res.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value).trim(), "", "bytes arrive before the work finishes");

  finish(Response.json({ success: true, posts: [{ hookTitle: "لبخند ‌زیبا ۱۲۳" }] }));
  let text = new TextDecoder().decode(first.value);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  const data = JSON.parse(text);
  assert.equal(data.success, true);
  assert.equal(data.posts[0].hookTitle, "لبخند ‌زیبا ۱۲۳");
});

test("a slow failure keeps its error and original status in the streamed body", async () => {
  const work = new Promise((r) => setTimeout(() => r(Response.json(
    { success: false, code: "CALENDAR_GENERATION_TIMEOUT", error: "took too long" }, { status: 504 }
  )), 30));
  const res = await respondWithHeartbeat(work, { startAfterMs: 5, intervalMs: 5 });
  assert.equal(res.status, 200);
  const data = JSON.parse(await res.text());
  assert.equal(data.success, false);
  assert.equal(data.status, 504);
  assert.equal(data.code, "CALENDAR_GENERATION_TIMEOUT");
});

test("a rejected work promise still answers with JSON", async () => {
  const res = await respondWithHeartbeat(Promise.reject(new Error("boom")), { startAfterMs: 1000 });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).success, false);
});

test("client failure classification", () => {
  assert.equal(getCalendarGenerationFailureMessage(new DOMException("t", "TimeoutError")), CALENDAR_TIMEOUT_MESSAGE);
  assert.equal(getCalendarGenerationFailureMessage(new DOMException("a", "AbortError")), CALENDAR_TIMEOUT_MESSAGE);
  assert.equal(getCalendarGenerationFailureMessage(new TypeError("Failed to fetch")), CALENDAR_NETWORK_MESSAGE);
  assert.equal(getCalendarGenerationFailureMessage(new Error("The server returned a non-JSON response (HTTP 502).")),
    "The server returned a non-JSON response (HTTP 502).");
});

test("Persian hashtags containing ZWNJ are stripped whole from the caption body", () => {
  const caption = "متن «نمونه» با اعداد ۱۲۳، و نیم‌فاصله؛ #می‌خواهم #زیبایی_پوست";
  const { caption: out } = mergeHashtagsIntoCaption(caption, ["#می‌خواهم", "#پوست"], { brandName: "کلینیک" });
  const body = out.split("\n\n")[0];
  assert.equal(body, "متن «نمونه» با اعداد ۱۲۳، و نیم‌فاصله؛");
  assert.ok(out.includes("#می‌خواهم"), "the canonical hashtag keeps its ZWNJ");
});

test("ZWNJ hashtags are removed whole, with no orphan ZWNJ left behind", () => {
  for (const tag of ["#می‌خواهم", "#کسب‌وکار", "#سلامت_دهان"]) {
    const { caption } = mergeHashtagsIntoCaption(`متن نمونه ${tag} پایان`, ["#لبخند"], {});
    const body = caption.split("\n\n")[0];
    assert.equal(body, "متن نمونه پایان", tag);
    assert.ok(!body.includes("‌"), `${tag} left a ZWNJ`);
  }
});

// ─── Persian slide-label fallback ─────────────────────────────────────────────
const slidesOf = (post, contentLanguage = "fa") =>
  buildFallbackOutputImageTextRequirements({ format: "Carousel", ...post }, { contentLanguage }).slides;
const allText = (slides) => slides.flatMap((s) => Object.values(s.fields)).join(" | ");

test("Persian slide labels are stripped (Persian, ASCII and Arabic-Indic digits, : and - separators)", () => {
  const slides = slidesOf({
    hookTitle: "لبخند زیبا",
    contentStructure: "اسلاید ۱: مشکل رایج\nاسلاید 2: راه‌حل ما\nاسلاید ٣ - نتیجه واقعی\nاسلاید ۴ : نوبت بگیرید",
  });
  assert.equal(slides.length, 4);
  assert.ok(!/اسلاید/.test(allText(slides)), allText(slides));
  assert.equal(slides[0].fields.subheadline, "مشکل رایج");
  assert.equal(slides[1].fields.main_headline, "راه‌حل ما");
  assert.equal(slides[2].fields.main_headline, "نتیجه واقعی");
  assert.equal(slides[3].fields.main_headline, "نوبت بگیرید");
});

test("Persian two-digit slide numbers count and strip correctly", () => {
  const structure = Array.from({ length: 12 }, (_, i) =>
    `اسلاید ${String(i + 1).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d])}: نکته ${i + 1}`).join("\n");
  assert.equal(parseSlideCountFromContentStructure(structure), 12);
  assert.equal(parseSlideCountFromContentStructure("اسلاید 12: پایان"), 12);
  assert.equal(parseSlideCountFromContentStructure("اسلاید ١٢: پایان"), 12);
  const slides = slidesOf({ hookTitle: "تیتر", contentStructure: structure });
  assert.equal(slides.length, 12);
  assert.equal(slides[11].fields.main_headline, "نکته 12");
  assert.ok(!/اسلاید/.test(allText(slides)));
});

test("normal prose mentioning اسلاید is not damaged", () => {
  const slides = slidesOf({
    hookTitle: "تیتر",
    contentStructure: "اسلایدها را با دقت ببینید\nاسلاید ۱ را با نیم‌فاصله طراحی کنید\nدر هر اسلاید یک پیام",
  });
  assert.equal(slides[0].fields.subheadline, "اسلایدها را با دقت ببینید");
  assert.equal(slides[1].fields.main_headline, "اسلاید ۱ را با نیم‌فاصله طراحی کنید");
  assert.equal(slides[2].fields.main_headline, "در هر اسلاید یک پیام");
  assert.equal(parseSlideCountFromContentStructure("اسلاید ۱ را ببینید\nدر هر اسلاید یک پیام"), 2, "prose is not read as labels");
});

test("Persian carousel fallback stays populated, Persian and valid", () => {
  const post = { format: "Carousel", hookTitle: "لبخند زیبا", coreMessage: "لمینت", contentStructure: "اسلاید ۱: مشکل\nاسلاید ۲: راه‌حل\nاسلاید ۳: نتیجه" };
  const s = buildFallbackOutputImageTextRequirements(post, { contentLanguage: "fa" });
  assert.equal(validateOutputImageTextRequirements({ ...post, outputImageTextRequirementsStructured: s }).valid, true);
  const display = formatOutputImageTextRequirementsForDisplay(s);
  assert.ok(display && display.includes("راه‌حل"));
});

// ─── Reel fallback ────────────────────────────────────────────────────────────
test("Persian Reel fallback produces meaningful on-image text from source content", () => {
  const post = { format: "Reel", hookTitle: "لبخند زیباتر در ۳ جلسه", coreMessage: "لمینت سرامیکی", caption: "لمینت سرامیکی ظاهری کاملاً طبیعی دارد. همین امروز نوبت مشاوره بگیرید." };
  const s = buildFallbackOutputImageTextRequirements(post, { contentLanguage: "fa" });
  assert.equal(s.type, "video");
  assert.equal(s.items[0].main_headline, "لبخند زیباتر در ۳ جلسه");
  assert.equal(s.items[0].additional_text_notes, "لمینت سرامیکی ظاهری کاملاً طبیعی دارد.");
  assert.equal(s.items[0].call_to_action, "همین امروز نوبت مشاوره بگیرید");
  assert.equal(validateOutputImageTextRequirements({ ...post, outputImageTextRequirementsStructured: s }).valid, true);
  assert.match(formatOutputImageTextRequirementsForDisplay(s), /لبخند زیباتر در ۳ جلسه/);
});

test("Reel fallback uses a Persian structure line (label stripped) when there is no caption", () => {
  const s = buildFallbackOutputImageTextRequirements({ format: "Reel", hookTitle: "قبل و بعد", contentStructure: "اسلاید ۱: نمایش نتیجه درمان" }, { contentLanguage: "fa" });
  assert.equal(s.items[0].additional_text_notes, "نمایش نتیجه درمان");
});

test("Reel fallback invents nothing when there is no source text", () => {
  assert.deepEqual(buildFallbackOutputImageTextRequirements({ format: "Reel" }), { type: "video", items: [] });
});

// ─── English unchanged ────────────────────────────────────────────────────────
test("English Slide labels behave exactly as before", () => {
  const slides = slidesOf({
    hookTitle: "Big smile",
    contentStructure: "Slide 1: The problem\nSlide 2 - Our fix — fast results\nSlide 3: Book today",
  }, "en");
  assert.equal(slides.length, 3);
  assert.equal(slides[0].fields.subheadline, "The problem");
  assert.equal(slides[1].fields.main_headline, "Our fix");
  assert.equal(slides[1].fields.supporting_text, "fast results");
  assert.equal(slides[2].fields.main_headline, "Book today");
  assert.equal(parseSlideCountFromContentStructure("Slide 1: a\nSlide 6: b"), 6);
  assert.equal(parseSlideCountFromContentStructure("Slide 1: a Slide 2: b"), 2);
});

test("English Static fallback output is unchanged", () => {
  const s = buildFallbackOutputImageTextRequirements({
    format: "Static", hookTitle: "Brighter smiles", mainAngle: "education",
    contentStructure: "Slide 1: Whitening basics\n• Safe for enamel\n2) Lasts months",
    caption: "Whitening is safe and quick. Book a consultation today.",
  });
  assert.deepEqual(s, {
    type: "static",
    items: [{
      main_headline: "Brighter smiles",
      subheadline: "Whitening basics",
      badge_or_label: s.items[0].badge_or_label,
      additional_text_notes: "• Safe for enamel  • Lasts months",
      call_to_action: "Book a consultation today",
    }],
  });
});
