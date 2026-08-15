// Drives the real uploadPublishedPostMedia() against an in-memory SFTP server.
import { mkdirSync, writeFileSync, rmSync } from "fs";
import path from "path";
import { startSftpServer } from "./sftp-test-server.mjs";

const BRAND = "__test-brand__";
const POST = "__test-post__";
const SIZE = 3 * 1024 * 1024;
const localDir = path.join(process.cwd(), "public", "uploads", BRAND, "published-posts", POST);
const fileName = "video.mp4";

mkdirSync(localDir, { recursive: true });
writeFileSync(path.join(localDir, fileName), Buffer.alloc(SIZE, 42));

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

const post = { id: POST, postNumber: 7, thumbnailUrl: null };
const mediaRecords = [{
  order: 1,
  mediaType: "VIDEO",
  url: `/uploads/${BRAND}/published-posts/${POST}/${fileName}`,
}];

async function run(serverOpts, label) {
  const srv = await startSftpServer(serverOpts);
  process.env.PUBLISHED_MEDIA_FTP_HOST = "127.0.0.1";
  process.env.PUBLISHED_MEDIA_FTP_PORT = String(srv.port);
  process.env.PUBLISHED_MEDIA_FTP_USER = "test";
  process.env.PUBLISHED_MEDIA_FTP_PASSWORD = "test";
  process.env.PUBLISHED_MEDIA_REMOTE_BASE = "/upload";
  process.env.PUBLISHED_MEDIA_PUBLIC_BASE_URL = "https://files.example.com";

  // Imported fresh per run so the module-level fastPutSupported flag resets.
  const mod = await import(`../lib/published-post-remote-media.js?v=${label}`);
  const result = await mod.uploadPublishedPostMedia({ post, mediaRecords, brandId: BRAND });
  srv.close();
  return { result, files: srv.files };
}

try {
  // 1 — healthy server: upload succeeds and every byte lands.
  {
    const { result, files } = await run({}, "ok");
    check("healthy upload reports success", result.success === true,
      result.detailCode || result.error || "");
    const stored = [...files.entries()].find(([p]) => p.includes("video_POST-0007"));
    check("remote file is byte-complete", stored && stored[1].length === SIZE,
      stored ? `${stored[1].length}/${SIZE}` : "no file stored");
  }

  // 2 — server silently drops writes past 1 MB, exactly like a mid-transfer cut.
  //     This is the production bug: it used to be reported as success.
  {
    const { result } = await run({ truncateAfter: 1024 * 1024 }, "truncated");
    check("truncated upload is NOT reported as success", result.success === false,
      `success=${result.success}`);
    check("truncation is classified as size mismatch",
      result.detailCode === "SFTP_SIZE_MISMATCH", result.detailCode || "");
  }
  // 3 — server rejects fastPut's parallel writes: must fall back to put()
  //     and still deliver a complete file.
  {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...a) => { warnings.push(a.map(String).join(' ')); };
    let out;
    try {
      out = await run({ rejectOutOfOrderWrites: true }, 'fallback');
    } finally {
      console.warn = origWarn;
    }
    check('falls back to stream upload when fastPut fails',
      warnings.some((w) => w.includes('fastPut unavailable')),
      warnings.join(' | ') || 'no warning seen');
    check('fallback upload reports success', out.result.success === true,
      out.result.detailCode || '');
    const stored = [...out.files.entries()].find(([p]) => p.includes('video_POST-0007'));
    check('fallback file is byte-complete', stored && stored[1].length === SIZE,
      stored ? stored[1].length + '/' + SIZE : 'no file stored');
  }
} finally {
  rmSync(path.join(process.cwd(), "public", "uploads", BRAND), { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
