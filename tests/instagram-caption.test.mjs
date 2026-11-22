// Instagram caption rules — deterministic layer (lib/instagram-caption.js).
// Pure functions: no prisma, no AI, no mocks.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTION_RULES,
  buildCaptionBrandFooter,
  extractBrandFooterInfo,
  normalizeHashtag,
  normalizeInstagramCaption,
  parseInstagramCaption,
  selectMostRelevantHashtags,
  splitLongParagraph,
  splitSentences,
  validateInstagramCaption,
} from "../lib/instagram-caption.js";

const CUCCTV = { name: "CUCCTV", website: "https://cucctv.co.uk/", businessLocation: "Manchester, The Uk" };
const CUCCTV_TONE = { contactInformation: "Contact: 01618506050, Website: cucctv.co.uk" };
const footerInfo = extractBrandFooterInfo(CUCCTV, CUCCTV_TONE);
const hashtagContext = { brandName: "CUCCTV", mainServicesOrProducts: "CCTV installation, alarm systems", businessLocation: "Manchester" };

// The fixture from the task, verbatim (including the whitespace-only line).
const MESSY =
  "This is a really useful CCTV tip. This sentence explains the first point. This explains another point. This paragraph keeps going and going.\n\n \nContact us today!!!\n\n#cctv #security #cctv #random #manchester #camera #install";

const blocks = (caption) => caption.split("\n\n");
const lastLineTags = (caption) => caption.split("\n").at(-1).split(" ");

// ── 9-11 paragraphs and spacing ──────────────────────────────────────────────
test("9. a long paragraph is split at sentence boundaries (max 3 sentences)", () => {
  const r = normalizeInstagramCaption(MESSY, { footerInfo, hashtagContext });
  assert.equal(blocks(r.caption)[0], "This is a really useful CCTV tip. This sentence explains the first point. This explains another point.");
  assert.equal(blocks(r.caption)[1], "This paragraph keeps going and going.");
  assert.ok(r.changes.some((c) => c.type === "paragraphs"));
});

test("9b. the character limit also splits, and a single over-long sentence is never cut", () => {
  const s1 = `${"word ".repeat(40).trim()}.`; // ~200 chars
  const s2 = `${"more ".repeat(30).trim()}.`; // ~150 chars
  assert.deepEqual(splitLongParagraph(`${s1} ${s2}`), [s1, s2]);
  const huge = `${"x".repeat(400)} end.`;
  assert.deepEqual(splitLongParagraph(huge), [huge]);
  const r = normalizeInstagramCaption(huge, { footerInfo, hashtagContext });
  assert.ok(r.warnings.some((w) => w.code === "PARAGRAPH_TOO_LONG"));
});

test("9c. sentence splitting never breaks URLs, e-mails, decimals, abbreviations or names", () => {
  assert.deepEqual(splitSentences("Visit cucctv.co.uk today. Dr. Smith said 3.5 is e.g. fine! Mail info@x.co.uk now? Yes."), [
    "Visit cucctv.co.uk today.",
    "Dr. Smith said 3.5 is e.g. fine!",
    "Mail info@x.co.uk now?",
    "Yes.",
  ]);
  assert.deepEqual(splitSentences("Talk to J. R. Smith. Then go."), ["Talk to J. R. Smith.", "Then go."]);
});

test("10. exactly one blank line between paragraphs, footer and hashtags", () => {
  const r = normalizeInstagramCaption(MESSY, { footerInfo, hashtagContext });
  assert.ok(!/\n{3,}/.test(r.caption));
  assert.ok(!/[ \t]+$/m.test(r.caption));
  assert.equal(r.caption, r.caption.trim());
  assert.deepEqual(blocks(r.caption).slice(-2, -1), ["CUCCTV\n📍 Manchester, The Uk\n🌐 cucctv.co.uk\n📞 01618506050"]);
});

test("11. multiple / whitespace-only blank lines and duplicate spaces are normalised; single-line blocks kept", () => {
  const input = "First  line   here.\n\n\n\n   \nSecond.\nA kept single line CTA\n\n\n#a1 #b2 #c3 #d4 #e5   ";
  const r = normalizeInstagramCaption(input, { footerInfo, hashtagContext });
  assert.deepEqual(blocks(r.caption).slice(0, 2), ["First line here.", "Second.\nA kept single line CTA"]);
});

test("11b. normalisation is idempotent and its output passes the save gate", () => {
  const once = normalizeInstagramCaption(MESSY, { footerInfo, hashtagContext }).caption;
  const twice = normalizeInstagramCaption(once, { footerInfo, hashtagContext }).caption;
  assert.equal(twice, once);
  assert.deepEqual(validateInstagramCaption(once, { footerInfo }), { ok: true, failures: [], warnings: [] });
});

// ── 12-14 Brand footer ───────────────────────────────────────────────────────
test("12. Brand footer is built from stored Brand data and placed right before the hashtags", () => {
  const r = normalizeInstagramCaption("Short tip.\n\n#a1 #b2 #c3 #d4 #e5", { footerInfo, hashtagContext });
  assert.equal(r.caption, "Short tip.\n\nCUCCTV\n📍 Manchester, The Uk\n🌐 cucctv.co.uk\n📞 01618506050\n\n#a1 #b2 #c3 #d4 #e5");
});

test("13. missing Brand fields are omitted; name-only when nothing else is stored; prose is never used", () => {
  const minimal = extractBrandFooterInfo({ name: "Smart CC", website: "", businessLocation: "" }, { contactInformation: "Choose chat or call us" });
  assert.deepEqual(minimal, { name: "Smart CC", website: "", location: "", phone: "", email: "" });
  assert.equal(buildCaptionBrandFooter(minimal), "Smart CC");

  const withEmail = extractBrandFooterInfo(
    { name: "Reach", website: "", businessLocation: "" },
    { contactInformation: "reach@educationcentre.ca; Reach Learning Centre, locations in Richmond" },
  );
  assert.equal(buildCaptionBrandFooter(withEmail), "Reach\n✉️ reach@educationcentre.ca");
  assert.equal(extractBrandFooterInfo(null, null).name, "");
});

test("14. footer is never duplicated: existing footer rebuilt, contact already in the CTA omitted", () => {
  const once = normalizeInstagramCaption("Tip.\n\n#a1 #b2 #c3 #d4 #e5", { footerInfo, hashtagContext }).caption;
  const doubled = once.replace("\n\n#a1", `\n\n${blocks(once)[1]}\n\n#a1`); // footer pasted twice
  const r = normalizeInstagramCaption(doubled, { footerInfo, hashtagContext });
  assert.equal(r.caption, once);
  assert.equal(r.caption.split("CUCCTV\n").length - 1, 1);

  const cta = "Tip.\n\nCall 0161 850 6050 or visit cucctv.co.uk to book.\n\n#cctv #alarm";
  const r2 = normalizeInstagramCaption(cta, { footerInfo, hashtagContext });
  assert.equal(blocks(r2.caption).at(-2), "CUCCTV\n📍 Manchester, The Uk");
  assert.ok(validateInstagramCaption(r2.caption, { footerInfo }).ok);
});

// ── 15-20 hashtags ───────────────────────────────────────────────────────────
test("15-17, 19. exactly 5 unique hashtags; duplicates removed; >5 reduced", () => {
  const r = normalizeInstagramCaption(MESSY, { footerInfo, hashtagContext });
  const tags = lastLineTags(r.caption);
  assert.equal(tags.length, CAPTION_RULES.hashtagCount);
  assert.equal(new Set(tags.map((t) => t.toLowerCase())).size, 5);
  assert.deepEqual(tags, ["#cctv", "#security", "#manchester", "#camera", "#install"]);
  assert.equal((r.caption.match(/#/g) || []).length, 5, "no hashtag anywhere else");
});

test("18. fewer than 5 are supplemented only from stored Brand data, only the missing amount", () => {
  const r = normalizeInstagramCaption("Tip.\n\n#cctv #manchester", { footerInfo, hashtagContext });
  assert.deepEqual(r.hashtags.slice(0, 2), ["#cctv", "#manchester"], "existing tags preserved first");
  assert.equal(r.hashtags.length, 5);
  for (const t of r.hashtags.slice(2)) {
    assert.ok(["#CCTVInstallation", "#AlarmSystems", "#CUCCTV"].includes(t), t);
  }
});

test("18b. with no Brand data to derive from, tags are NOT invented: a warning is returned and the gate fails", () => {
  const r = normalizeInstagramCaption("Tip.\n\n#one", { footerInfo: { name: "X" }, hashtagContext: {} });
  assert.deepEqual(r.hashtags, ["#one"]);
  assert.ok(r.warnings.some((w) => w.code === "HASHTAGS_INSUFFICIENT"));
  assert.equal(validateInstagramCaption(r.caption, { footerInfo: { name: "X" } }).ok, false);
});

test("20. relevance: generic/off-topic tags are dropped first when reducing", () => {
  const picked = selectMostRelevantHashtags(
    ["#love", "#cctv", "#pizza", "#manchester", "#viral", "#alarm", "#instagood", "#security"],
    "CCTV and alarm security systems installed in Manchester",
  );
  assert.deepEqual(picked, ["#cctv", "#pizza", "#manchester", "#alarm", "#security"]);
  assert.ok(!picked.includes("#love") && !picked.includes("#viral") && !picked.includes("#instagood"));
});

test("hashtags: malformed are dropped/fixed, never contain spaces, ZWNJ or diacritics; in-text tags keep their word", () => {
  assert.equal(normalizeHashtag("#café"), "#cafe");
  assert.equal(normalizeHashtag("#امنیت‌خانه"), "#امنیتخانه");
  assert.equal(normalizeHashtag("#cctv!"), "#cctv");
  assert.equal(normalizeHashtag("#2024"), null);
  assert.equal(normalizeHashtag("#a-b"), null);
  const r = normalizeInstagramCaption("We install #CCTV systems daily.\n\n#a1 #b2 #c3 #d4", { footerInfo, hashtagContext });
  assert.equal(blocks(r.caption)[0], "We install CCTV systems daily.");
  assert.ok(r.hashtags.includes("#CCTV"));
  assert.ok(r.changes.some((c) => /Moved in-text hashtags/.test(c.message)));
});

// ── Persian (24) ─────────────────────────────────────────────────────────────
test("24. Persian: text stays Persian, spacing fixed, Persian tags valid, footer from data", () => {
  const info = extractBrandFooterInfo({ name: "Dr.Ebadian Clinic", website: "https://drebadian.com/", businessLocation: "تهران" }, {});
  const input = "این یک نکته مفید است.  جمله دوم؟ جمله سوم! جمله چهارم.\n\n\n\n#پوست #زیبایی #پوست #تهران #مراقبت‌پوست #کلینیک";
  const r = normalizeInstagramCaption(input, { footerInfo: info, hashtagContext: {} });
  assert.equal(
    r.caption,
    "این یک نکته مفید است. جمله دوم؟ جمله سوم!\n\nجمله چهارم.\n\nDr.Ebadian Clinic\n📍 تهران\n🌐 drebadian.com\n\n#پوست #زیبایی #تهران #مراقبتپوست #کلینیک",
  );
  assert.ok(validateInstagramCaption(r.caption, { footerInfo: info }).ok);
});

// ── the save gate ────────────────────────────────────────────────────────────
test("validate: each required rule is enforced", () => {
  const good = normalizeInstagramCaption("Tip.\n\n#cctv", { footerInfo, hashtagContext }).caption;
  assert.ok(validateInstagramCaption(good, { footerInfo }).ok);
  const codes = (c) => validateInstagramCaption(c, { footerInfo }).failures.map((f) => f.code);

  assert.ok(codes(good.replace("\n\nCUCCTV", "\n\n\nCUCCTV")).includes("SPACING"));
  assert.ok(codes(good.replace("Tip.", "Tip.  ")).includes("SPACING"));
  assert.ok(codes(good.replace(/ #\w+$/, "")).includes("HASHTAG_COUNT"));
  assert.ok(codes(good.replace("Tip.", "Tip #extra.")).includes("HASHTAGS_OUTSIDE_BLOCK"));
  assert.ok(codes(good.replace("\n📞 01618506050", "")).includes("FOOTER_MISSING"));
  assert.ok(codes(good.replace(/^Tip\.\n\n/, "")).includes("EMPTY_CAPTION"));
  assert.ok(codes("").includes("EMPTY_CAPTION"));
  // duplicate tag in the final line
  assert.ok(codes(good.replace(/#\w+$/, lastLineTags(good)[0])).includes("HASHTAG_COUNT"));
  // a wrong count is reported once, without cascading into other rules
  assert.deepEqual(codes(good.replace(/ #\w+$/, "")), ["HASHTAG_COUNT"]);
});

test("parseInstagramCaption returns body without footer/tags and the user's raw unique tags", () => {
  const once = normalizeInstagramCaption(MESSY, { footerInfo, hashtagContext }).caption;
  const p = parseInstagramCaption(once, footerInfo);
  assert.ok(!p.body.includes("CUCCTV\n"));
  assert.ok(!p.body.includes("#"));
  const raw = parseInstagramCaption(MESSY, footerInfo);
  assert.deepEqual(raw.existingHashtags, ["#cctv", "#security", "#random", "#manchester", "#camera", "#install"]);
});

// ── Regressions found by the browser smoke test ──────────────────────────────
test("smoke: a caption with text but no footer reports FOOTER_MISSING, not an empty caption", () => {
  const codes = validateInstagramCaption("Book your survey this week!\n\n#a1 #b2 #c3 #d4 #e5", { footerInfo }).failures.map((f) => f.code);
  assert.deepEqual(codes, ["FOOTER_MISSING"]);
});

test("smoke: no-AI padding uses only safe Brand sources (no prose fragments, no 'The Uk', acronyms kept)", async () => {
  const { safeBrandHashtags } = await import("../lib/instagram-caption.js");
  // prose services field (real Smart CC shape) is never split into tags
  assert.deepEqual(
    safeBrandHashtags({ brandName: "Smart CC", businessLocation: "Iran", businessType: "SAAS", mainServicesOrProducts: "SmartCC is a Persian AI-powered SaaS platform designed to help small business owners, digital marketers, and SEO professionals create structured, publish-ready website articles faster. It helps." }),
    ["#SmartCC", "#Iran", "#SAAS"],
  );
  // list-like services are used; heading lines and article-led locations are not
  const tags = safeBrandHashtags({ brandName: "CUCCTV", businessLocation: "Manchester, The Uk", mainServicesOrProducts: "B2c sales:\nCCTV\nALARMS" });
  assert.deepEqual(tags, ["#CUCCTV", "#Manchester", "#CCTV", "#ALARMS"]);
  assert.ok(!tags.includes("#TheUk") && !tags.some((t) => /B2c/.test(t)));
  // so a thin caption on that Brand warns instead of inventing tags
  const r = normalizeInstagramCaption("Just a note.\n\n#one", {
    footerInfo: { name: "Smart CC" },
    hashtagContext: { brandName: "Smart CC", businessLocation: "Iran", businessType: "SAAS", mainServicesOrProducts: "A long prose description. With sentences." },
  });
  assert.deepEqual(r.hashtags, ["#one", "#SmartCC", "#Iran", "#SAAS"]);
  assert.ok(r.warnings.some((w) => w.code === "HASHTAGS_INSUFFICIENT"));
});
