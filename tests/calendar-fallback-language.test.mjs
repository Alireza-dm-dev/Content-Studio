// Language-aware image-text fallback and CTA preservation.
//
// Product rule: for non-English content the fallback is source-only. It never
// emits the English placeholders ("Slide N", "Key point N", "Ready to get
// started?") or the English angle badges, never translates them into generic
// filler, and only ever copies a CTA that already exists in the caption.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildFallbackOutputImageTextRequirements,
  validateOutputImageTextRequirements,
  mergeHashtagsIntoCaption,
} from "../lib/calendar-post-utils.js";

const fa = (post) => buildFallbackOutputImageTextRequirements(post, { contentLanguage: "fa" });
const en = (post) => buildFallbackOutputImageTextRequirements(post);
const ctaOf = (caption, format = "Static") => fa({ format, hookTitle: "لبخند زیبا", caption }).items[0].call_to_action;

const ENGLISH_FILLER = /Slide \d|Key point|Ready to get started|Learn more|Get started|Contact us|How It Works|Why It Matters|Limited Time|Join In|Behind The Scenes|Common Question|Real Results/i;
const texts = (s) => (s.slides ? s.slides.flatMap((x) => Object.values(x.fields)) : s.items.flatMap((x) => Object.values(x)));

// ─── Carousel ─────────────────────────────────────────────────────────────────
test("A: Persian carousel whose slide count matches its source lines", () => {
  const post = {
    format: "Carousel", hookTitle: "لبخند زیبا", mainAngle: "trust",
    contentStructure: "اسلاید ۱: مشکل رایج\nاسلاید ۲: راه‌حل ما — نتیجه سریع\nاسلاید ۳: نوبت مشاوره",
    caption: "همین امروز نوبت مشاوره بگیرید.",
  };
  const s = fa(post);
  assert.equal(s.slides.length, 3);
  assert.deepEqual(s.slides.map((x) => x.slideNumber), [1, 2, 3]);
  assert.equal(s.slides[1].fields.main_headline, "راه‌حل ما");
  assert.equal(s.slides[1].fields.supporting_text, "نتیجه سریع");
  assert.equal(s.slides[2].fields.call_to_action, "همین امروز نوبت مشاوره بگیرید");
  assert.ok(!ENGLISH_FILLER.test(texts(s).join(" | ")), texts(s).join(" | "));
  assert.equal(validateOutputImageTextRequirements({ ...post, outputImageTextRequirementsStructured: s }).valid, true);
});

test("B: Persian carousel needing more slides than source lines uses only source text, no filler", () => {
  const post = {
    format: "Carousel", hookTitle: "لبخند زیبا", coreMessage: "لمینت سرامیکی با ظاهر طبیعی", mainAngle: "promotion",
    contentStructure: "اسلاید ۱: مشکل",
    caption: "درمان فقط در دو جلسه انجام می‌شود. همین امروز نوبت مشاوره بگیرید.",
  };
  const s = fa(post);
  const all = texts(s);
  assert.ok(!ENGLISH_FILLER.test(all.join(" | ")), all.join(" | "));
  const source = [post.hookTitle, post.coreMessage, post.contentStructure, post.caption].join(" ");
  for (const t of all) assert.ok(source.includes(t), `"${t}" must come from the post's own text`);
  assert.deepEqual(s.slides.map((x) => x.slideNumber), s.slides.map((_, i) => i + 1), "renumbered 1..N");
  assert.ok(s.slides.every((x) => x.fields.main_headline || x.fields.supporting_text));
});

test("B: with no usable source beyond the hook, the fallback fails cleanly instead of padding", () => {
  assert.throws(() => fa({ format: "Carousel", hookTitle: "لبخند زیبا", mainAngle: "trust" }), (e) => e.code === "CALENDAR_OUTPUT_INVALID");
});

test("C: Persian carousel keeps the caption's existing Persian CTA verbatim", () => {
  const s = fa({ format: "Carousel", hookTitle: "لبخند", contentStructure: "اسلاید ۱: الف\nاسلاید ۲: ب\nاسلاید ۳: پ", caption: "برای اطلاعات بیشتر به لینک بیو مراجعه کنید!" });
  assert.equal(s.slides.at(-1).fields.call_to_action, "برای اطلاعات بیشتر به لینک بیو مراجعه کنید");
});

test("D: Persian carousel with no CTA in the source invents none", () => {
  const s = fa({ format: "Carousel", hookTitle: "لبخند", contentStructure: "اسلاید ۱: الف\nاسلاید ۲: ب\nاسلاید ۳: پ", caption: "لمینت دوام زیادی دارد." });
  assert.ok(s.slides.every((x) => !x.fields.call_to_action));
  assert.equal(s.slides.at(-1).fields.main_headline, "پ");
});

test("E: English brand/product names inside Persian content are preserved", () => {
  const s = fa({
    format: "Carousel", hookTitle: "لبخند با Invisalign", mainAngle: "case study",
    contentStructure: "اسلاید ۱: معرفی Dr. Ebadian Clinic\nاسلاید ۲: نتایج Invisalign\nاسلاید ۳: نوبت",
    caption: "در Dr. Ebadian Clinic مشاوره بگیرید.",
  });
  const all = texts(s).join(" | ");
  assert.match(all, /Invisalign/);
  assert.match(all, /Dr\. Ebadian Clinic/);
  assert.ok(!ENGLISH_FILLER.test(all), all);
  assert.equal(s.slides.at(-1).fields.call_to_action, "در Dr. Ebadian Clinic مشاوره بگیرید");
});

test("structural labels never leak into headline text, and none are invented", () => {
  // Labels with no text under them: nothing to show, so no slides are made up.
  assert.throws(
    () => fa({ format: "Carousel", hookTitle: "", coreMessage: "", contentStructure: "اسلاید ۱:\nاسلاید ۲:", caption: "" }),
    (e) => e.code === "CALENDAR_OUTPUT_INVALID"
  );
  const s = fa({ format: "Carousel", hookTitle: "لبخند", contentStructure: "اسلاید ۱: الف ب\nاسلاید ۲: پ ت\nاسلاید ۳: ث ج" });
  const all = texts(s).join(" | ");
  assert.ok(!/اسلاید|Slide/.test(all), all);
  // Labels exist only as the numeric slideNumber, rendered by the display layer.
  assert.deepEqual(s.slides.map((x) => x.slideNumber), [1, 2, 3]);
});

// ─── Persian CTA detection ────────────────────────────────────────────────────
test("Persian CTA with ZWNJ and with a normal space are both detected", () => {
  assert.equal(ctaOf("همین امروز ثبت‌نام کنید."), "همین امروز ثبت‌نام کنید");
  assert.equal(ctaOf("همین امروز ثبت نام کنید."), "همین امروز ثبت نام کنید");
});

test("Persian CTA surrounded by Persian or ASCII punctuation is detected", () => {
  assert.equal(ctaOf("درمان سریع است؛ همین حالا رزرو کنید!"), "همین حالا رزرو کنید");
  assert.equal(ctaOf("سؤالی دارید؟ «دایرکت بدهید»"), "«دایرکت بدهید»");
  assert.equal(ctaOf("قیمت مناسب است. پیام دهید..."), "پیام دهید");
});

test("Persian CTA returns the original text (Arabic ي/ك variants matched, not rewritten)", () => {
  // Arabic yeh/kaf in the source: matched via a normalised copy, returned as written.
  assert.equal(ctaOf("همين حالا رزرو كنيد."), "همين حالا رزرو كنيد");
  assert.equal(ctaOf("برای اطلاعات بیشتر، لینک بیو را ببینید."), "برای اطلاعات بیشتر، لینک بیو را ببینید");
});

test("supported Persian CTA phrases", () => {
  for (const phrase of [
    "تماس بگیرید", "با ما تماس بگیرید", "همین حالا تماس بگیرید", "رزرو کنید", "ثبت‌نام کنید",
    "درخواست دهید", "مشاوره بگیرید", "وقت بگیرید", "اطلاعات بیشتر", "بیشتر بدانید", "پیام دهید",
    "دایرکت بدهید", "دایرکت کنید", "لینک را ببینید", "لینک بیو",
  ]) {
    assert.equal(ctaOf(`متن پست درباره درمان است. ${phrase}.`), phrase, phrase);
  }
});

test("no CTA in the source → no CTA, for every format", () => {
  const caption = "لمینت دندان دوام زیادی دارد و ظاهری طبیعی ایجاد می‌کند.";
  for (const format of ["Static", "Reel"]) {
    const s = fa({ format, hookTitle: "لبخند", caption });
    assert.equal(s.items[0].call_to_action, undefined, format);
  }
  // "تماس" / "اطلاعات" as ordinary words are not CTAs.
  assert.equal(ctaOf("تماس با بیماران برای ما مهم است."), undefined);
});

// ─── Reel / Static ────────────────────────────────────────────────────────────
test("Persian Reel keeps an existing Persian CTA and stays Persian", () => {
  const s = fa({ format: "Reel", hookTitle: "قبل و بعد لمینت", mainAngle: "case study", caption: "نتیجه را در ویدیو ببینید. با ما تماس بگیرید." });
  assert.deepEqual(s, { type: "video", items: [{
    main_headline: "قبل و بعد لمینت",
    additional_text_notes: "نتیجه را در ویدیو ببینید.",
    call_to_action: "با ما تماس بگیرید",
  }] });
});

test("Persian Reel without a CTA invents none", () => {
  const s = fa({ format: "Reel", hookTitle: "قبل و بعد لمینت", caption: "نتیجه را در ویدیو ببینید." });
  assert.equal(s.items[0].call_to_action, undefined);
  assert.ok(!ENGLISH_FILLER.test(texts(s).join(" ")));
});

test("Persian Static stays Persian: no English badge, Persian CTA preserved", () => {
  const s = fa({ format: "Static", hookTitle: "لبخند زیبا", mainAngle: "education", contentStructure: "تیتر: مزایای لمینت", caption: "لمینت ظاهری طبیعی دارد. همین امروز وقت بگیرید." });
  const item = s.items[0];
  assert.equal(item.badge_or_label, undefined);
  assert.equal(item.call_to_action, "همین امروز وقت بگیرید");
  assert.ok(!ENGLISH_FILLER.test(texts(s).join(" ")));
});

// ─── English unchanged ────────────────────────────────────────────────────────
test("English fallback output is unchanged (placeholders and badges remain for English)", () => {
  assert.deepEqual(en({ format: "Carousel", hookTitle: "", mainAngle: "trust", caption: "Book a consult today." }), {
    type: "carousel",
    slides: [
      { slideNumber: 1, slideRole: "Hook", fields: { main_headline: "Slide 1", badge_or_label: "Why It Matters" } },
      { slideNumber: 2, slideRole: "Body", fields: { main_headline: "Key point 2" } },
      { slideNumber: 3, slideRole: "CTA", fields: { main_headline: "Ready to get started?", call_to_action: "Book a consult today" } },
    ],
  });
  assert.deepEqual(en({ format: "Carousel", hookTitle: "x", mainAngle: "trust" }), buildFallbackOutputImageTextRequirements({ format: "Carousel", hookTitle: "x", mainAngle: "trust" }, { contentLanguage: "en" }));
});

test("English CTA detection is unchanged", () => {
  const cta = (caption) => en({ format: "Static", hookTitle: "Smile", caption }).items[0].call_to_action;
  assert.equal(cta("Great results. Book your free consult today! More text"), "Book your free consult today");
  assert.equal(cta("Tap the link in bio to learn more."), "Tap the link in bio to learn more");
  assert.equal(cta("No call to action here."), undefined);
  // Persian patterns are not applied to English content.
  assert.equal(cta("Results speak. تماس بگیرید"), undefined);
});

test("ZWNJ hashtags still strip cleanly", () => {
  for (const tag of ["#می‌خواهم", "#کسب‌وکار", "#سلامت_دهان"]) {
    const body = mergeHashtagsIntoCaption(`متن ${tag} پایان`, ["#لبخند"], {}).caption.split("\n\n")[0];
    assert.equal(body, "متن پایان");
    assert.ok(!body.includes("‌"));
  }
});

// ─── Structural contract: count, splitting, insufficient source ───────────────
const words = (t) => t.replace(/[«»"'.,،؛;:!?؟()\-–—]/g, " ").split(/\s+/).filter(Boolean);
function assertSourceOnly(structured, post) {
  const source = new Set(words([post.hookTitle, post.coreMessage, post.contentStructure, post.caption].filter(Boolean).join(" ")));
  for (const t of texts(structured)) {
    for (const w of words(t)) assert.ok(source.has(w), `"${w}" (in "${t}") is not in the source`);
  }
}
const validFor = (post, s) => validateOutputImageTextRequirements({ ...post, outputImageTextRequirementsStructured: s });

test("1: enough source for the required count → valid carousel, no splitting needed", () => {
  const post = { format: "Carousel", hookTitle: "لبخند زیبا", coreMessage: "لمینت طبیعی است", caption: "درمان سریع انجام می‌شود. همین امروز وقت بگیرید.", contentStructure: "" };
  const s = fa(post);
  assert.equal(s.slides.length, 3);
  assert.equal(validFor(post, s).valid, true);
  assertSourceOnly(s, post);
});

test("2 + 10: explicit 5-slide Persian structure → exactly 5 slides, label order preserved", () => {
  const post = { format: "Carousel", hookTitle: "لبخند", contentStructure: "اسلاید ۱: مشکل\nاسلاید ۲: علت\nاسلاید ۳: راه‌حل\nاسلاید ۴: نتیجه\nاسلاید ۵: نوبت" };
  const s = fa(post);
  assert.deepEqual(s.slides.map((x) => x.slideNumber), [1, 2, 3, 4, 5]);
  assert.equal(s.slides[0].fields.subheadline, "مشکل");
  assert.deepEqual(s.slides.slice(1).map((x) => x.fields.main_headline), ["علت", "راه‌حل", "نتیجه", "نوبت"]);
  assert.equal(validFor(post, s).valid, true);
});

test("10: empty labels keep later labelled content in its own slide position", () => {
  const post = { format: "Carousel", hookTitle: "لبخند", coreMessage: "لمینت طبیعی است", contentStructure: "اسلاید ۱: مشکل\nاسلاید ۲:\nاسلاید ۳:\nاسلاید ۴: نتیجه نهایی", caption: "همین امروز نوبت بگیرید." };
  const s = fa(post);
  assert.equal(s.slides.length, 4);
  assert.equal(s.slides[3].fields.main_headline, "نتیجه نهایی");
  assert.equal(validFor(post, s).valid, true);
  assertSourceOnly(s, post);
});

test("3 + 4: source split at its own clause boundaries adds no new words", () => {
  const post = { format: "Carousel", hookTitle: "لبخند زیبا", caption: "لمینت سرامیکی ظاهری طبیعی دارد، دوام بالایی دارد و فقط در دو جلسه انجام می‌شود." };
  const s = fa(post);
  assert.equal(s.slides.length, 3);
  assert.equal(s.slides[1].fields.main_headline, "لمینت سرامیکی ظاهری طبیعی دارد");
  assert.equal(s.slides[2].fields.main_headline, "دوام بالایی دارد و فقط در دو جلسه انجام می‌شود.");
  assertSourceOnly(s, post);
  assert.equal(validFor(post, s).valid, true);
});

test("3: a labelled line with its own detail is split into headline and detail slides when needed", () => {
  const post = { format: "Carousel", hookTitle: "لبخند", contentStructure: "اسلاید ۱: مشکل\nاسلاید ۲: راه‌حل ما — نتیجه سریع و طبیعی\nاسلاید ۳:" };
  const s = fa(post);
  assert.equal(s.slides.length, 3);
  assertSourceOnly(s, post);
  assert.equal(validFor(post, s).valid, true);
});

test("5 + 6: insufficient source throws CALENDAR_OUTPUT_INVALID — never a 1–2 slide carousel that breaks the contract", () => {
  const cases = [
    { format: "Carousel", hookTitle: "لبخند" },
    { format: "Carousel", hookTitle: "", caption: "" },
    // Explicit 4 slides but only two have text and nothing can be split.
    { format: "Carousel", hookTitle: "لبخند", contentStructure: "اسلاید ۱: مشکل\nاسلاید ۲:\nاسلاید ۳:\nاسلاید ۴: نتیجه" },
  ];
  for (const post of cases) {
    assert.throws(() => fa(post), (e) => e.code === "CALENDAR_OUTPUT_INVALID", JSON.stringify(post));
  }
});

test("6: every successful source-only carousel satisfies the validator", () => {
  const posts = [
    { format: "Carousel", hookTitle: "لبخند", caption: "جمله اول کامل است. جمله دوم هم کامل است." },
    { format: "Carousel", hookTitle: "", coreMessage: "پیام اصلی پست", caption: "جزئیات بیشتر در این جمله آمده است." },
    { format: "Carousel", hookTitle: "لبخند", contentStructure: "مقدمه کوتاه\nبخش دوم\nبخش سوم\nبخش چهارم" },
  ];
  for (const post of posts) {
    const s = fa(post);
    assert.equal(validFor(post, s).valid, true, JSON.stringify(s));
    assert.ok(s.slides.length >= 2);
  }
});

test("7 + 8: no English or Persian generic filler is ever added", () => {
  const PERSIAN_FILLER = /نکته کلیدی|آماده‌اید|اطلاعات بیشتر|تماس بگیرید|اسلاید \d/;
  const post = { format: "Carousel", hookTitle: "لبخند زیبا", mainAngle: "promotion", caption: "لمینت سرامیکی ظاهری طبیعی دارد، دوام بالایی دارد." };
  const all = texts(fa(post)).join(" | ");
  assert.ok(!ENGLISH_FILLER.test(all), all);
  assert.ok(!PERSIAN_FILLER.test(all), all);
});

test("9: CTA appears only when the caption has one", () => {
  const withCta = fa({ format: "Carousel", hookTitle: "لبخند", contentStructure: "اسلاید ۱: الف ب\nاسلاید ۲: پ ت\nاسلاید ۳: ث ج", caption: "همین امروز وقت بگیرید." });
  assert.equal(withCta.slides.at(-1).fields.call_to_action, "همین امروز وقت بگیرید");
  const without = fa({ format: "Carousel", hookTitle: "لبخند", contentStructure: "اسلاید ۱: الف ب\nاسلاید ۲: پ ت\nاسلاید ۳: ث ج", caption: "متن ساده بدون دعوت." });
  assert.ok(without.slides.every((x) => !x.fields.call_to_action));
});

test("12 + 13: Reel and Static fallbacks are unchanged by the carousel contract", () => {
  assert.deepEqual(fa({ format: "Reel", hookTitle: "قبل و بعد", caption: "نتیجه را ببینید. با ما تماس بگیرید." }),
    { type: "video", items: [{ main_headline: "قبل و بعد", additional_text_notes: "نتیجه را ببینید.", call_to_action: "با ما تماس بگیرید" }] });
  assert.deepEqual(fa({ format: "Reel" }), { type: "video", items: [] });
  assert.deepEqual(fa({ format: "Static", hookTitle: "لبخند", mainAngle: "trust" }), { type: "static", items: [{ main_headline: "لبخند" }] });
});

test("11: English carousel fallback is byte-identical (still padded, never throws)", () => {
  const post = { format: "Carousel", hookTitle: "", mainAngle: "trust" };
  assert.deepEqual(JSON.stringify(en(post)),
    '{"type":"carousel","slides":[{"slideNumber":1,"slideRole":"Hook","fields":{"main_headline":"Slide 1","badge_or_label":"Why It Matters"}},{"slideNumber":2,"slideRole":"Body","fields":{"main_headline":"Key point 2"}},{"slideNumber":3,"slideRole":"CTA","fields":{"main_headline":"Ready to get started?","badge_or_label":"Why It Matters"}}]}');
});
