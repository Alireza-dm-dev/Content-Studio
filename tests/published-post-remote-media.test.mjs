// Regression tests for the SFTP upload timeout budget
// (lib/published-post-remote-media.js).
//
// Background: calcUploadTimeout previously assumed a fixed ~128 KB/s throughput
// with no safety margin and capped at 10 minutes. Small images/PDFs (a few
// KB-MB, uploading in milliseconds) always finished inside the budget, so they
// succeeded. Videos (tens of MB, uploaded over minutes at real-world
// ~33-150 KB/s) could equal or exceed the deadline and fail with
// SFTP_UPLOAD_TIMEOUT — leaving the post saved with a local video_url and the
// client with "media could not be uploaded to the public media server".
import { test } from "node:test";
import assert from "node:assert/strict";

import { calcUploadTimeout } from "@/lib/published-post-remote-media";

const MIN = 180000;      // UPLOAD_TIMEOUT_MIN_MS
const MAX = 1800000;     // UPLOAD_TIMEOUT_MAX_MS
const MB = 1024 * 1024;

test("small image/PDF files keep the 3-minute floor (behaviour unchanged)", () => {
  for (const size of [1024, 128 * 1024, 1 * MB]) {
    assert.equal(calcUploadTimeout(size), MIN);
  }
  // Larger-but-still-small files get a generous (not reduced) budget.
  assert.ok(calcUploadTimeout(5 * MB) >= MIN && calcUploadTimeout(5 * MB) <= MAX);
});

test("budget guarantees a safe ~16 KB/s floor (videos, before the cap binds)", () => {
  // Until the 30-minute cap binds (~28 MB), the budget guarantees one second
  // per 16 KB transferred, i.e. uploads never fail while progress continues.
  for (const mb of [10, 20, 28]) {
    const size = mb * MB;
    const budget = calcUploadTimeout(size);
    const floor = Math.ceil(size / (16 * 1024)) * 1000;
    assert.ok(budget >= floor, `${mb}MB: budget ${budget}ms < 16KB/s floor ${floor}ms`);
  }
});

test("large videos no longer hit the old 10-minute cap that broke them", () => {
  // 60 MB under the old formula: 30000 + 60MB/128KB*1000 = 495s < old 600s cap.
  // New formula must raise the ceiling for such files.
  for (const mb of [36, 60, 87, 100]) {
    assert.ok(calcUploadTimeout(mb * MB) > 600000, `${mb}MB should exceed the old 10min cap`);
  }
});

test("reported failure case (36MB video) now fits even at the slowest observed link", () => {
  // Measured SFTP throughput to the public media server ranged ~33-150 KB/s.
  // The originally failing upload was a ~36MB video. Under the old formula the
  // budget was 318s; at the observed 33 KB/s the transfer needs ~1116s, so it
  // deterministically timed out. The new budget must fit both extremes.
  for (const mb of [36, 50]) {
    const size = mb * MB;
    const needSlow = Math.round(size / (33 * 1024));   // worst observed link
    const needFast = Math.round(size / (150 * 1024));  // best observed link
    const budget = calcUploadTimeout(size);
    assert.ok(budget >= needSlow, `${mb}MB at 33KB/s needs ${needSlow}ms, budget only ${budget}ms`);
    assert.ok(budget >= needFast, `${mb}MB at 150KB/s needs ${needFast}ms, budget only ${budget}ms`);
  }
});

test("budget is bounded (never infinite), and never below the floor", () => {
  assert.equal(calcUploadTimeout(200 * MB), MAX);
  assert.ok(calcUploadTimeout(0) === MIN);
});
