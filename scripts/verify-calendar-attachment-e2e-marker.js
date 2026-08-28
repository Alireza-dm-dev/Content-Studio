#!/usr/bin/env node
// End-to-end verification that a unique marker embedded in an uploaded
// reference file survives the full pipeline used by BOTH calendar creation
// and post regeneration:
//
//   raw file bytes
//     -> extractCalendarAttachmentText        (lib/calendar-attachment-utils.js)
//     -> interpretCalendarAttachment           (lib/calendar-attachment-interpreter.js)
//     -> resolveCalendarAttachmentContext      (lib/calendar-attachment-context.js)
//     -> .block  (this exact string is spliced into userInput by both
//                 app/api/content-calendar/generate/route.js and
//                 app/api/calendar-posts/[id]/regenerate/route.js)
//
// Also covers the specific regression this suite was written for: an
// interpretation-layer configuration failure (missing PromptTemplate row,
// missing OpenAI key) must surface as a distinguishable `code`, not collapse
// into the same generic message for every file type.
//
// Run: node scripts/verify-calendar-attachment-e2e-marker.js

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

import { extractCalendarAttachmentText } from '../lib/calendar-attachment-utils.js';
import { interpretCalendarAttachment } from '../lib/calendar-attachment-interpreter.js';
import { resolveCalendarAttachmentContext } from '../lib/calendar-attachment-context.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ─── Fixture builders ───────────────────────────────────────────────────────

// Builds a PDF with a correct, dynamically-computed xref table (byte offsets
// must match the real object positions or pdf.js silently returns empty page
// content instead of throwing — a hand-rolled table with fixed offsets only
// works for the one text length it was hardcoded for).
function createMinimalPdf(text) {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const objects = [
    '1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n',
    '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n',
    '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>\nendobj\n',
    '4 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>\nendobj\n',
  ];
  const streamContent = `BT /F1 12 Tf 72 700 Td (${escaped}) Tj ET`;
  const streamBytes = Buffer.byteLength(streamContent, 'utf-8');
  objects.push(`5 0 obj\n<</Length ${streamBytes}>>\nstream\n${streamContent}\nendstream\nendobj\n`);

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf-8'));
    body += obj;
  }
  const xrefOffset = Buffer.byteLength(body, 'utf-8');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  xref += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;
  body += xref;
  return Buffer.from(body, 'utf-8');
}

function createMinimalDocx(text) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'docx-e2e-'));
  try {
    const wordDir = join(tmpDir, 'word');
    const docPropsDir = join(tmpDir, 'docProps');
    const relsDir = join(tmpDir, '_rels');
    const wordRelsDir = join(wordDir, '_rels');
    execSync(`mkdir -p "${wordDir}" "${docPropsDir}" "${relsDir}" "${wordRelsDir}"`);

    writeFileSync(join(tmpDir, '[Content_Types].xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

    writeFileSync(join(relsDir, '.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

    writeFileSync(join(wordRelsDir, 'document.xml.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

    writeFileSync(join(wordDir, 'document.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`);

    const zipPath = join(tmpDir, 'output.docx');
    execSync(`cd "${tmpDir}" && zip -q -r "${zipPath}" . -i '*.xml' -i '*.rels'`, { shell: true });
    return readFileSync(zipPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Marker fixtures per supported format ──────────────────────────────────

function buildFixtures(marker) {
  return [
    { ext: '.txt', fileName: 'ref.txt', mimeType: 'text/plain', buffer: Buffer.from(`Reference notes.\n${marker}\nEnd of notes.`, 'utf-8') },
    { ext: '.md', fileName: 'ref.md', mimeType: 'text/markdown', buffer: Buffer.from(`# Brief\n\n${marker}\n`, 'utf-8') },
    { ext: '.csv', fileName: 'ref.csv', mimeType: 'text/csv', buffer: Buffer.from(`field,value\nnote,${marker}\n`, 'utf-8') },
    { ext: '.json', fileName: 'ref.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ note: marker }), 'utf-8') },
    { ext: '.pdf', fileName: 'ref.pdf', mimeType: 'application/pdf', buffer: createMinimalPdf(marker) },
    { ext: '.docx', fileName: 'ref.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: createMinimalDocx(marker) },
  ];
}

// A stand-in for the OpenAI call: a real interpreter model would paraphrase,
// but it is expected to preserve concrete facts (like a marker token) in the
// summary/keyFacts fields — this mock exercises exactly that contract.
function makeEchoingGenerateFn() {
  return async ({ variables }) => ({
    content: JSON.stringify({
      schemaVersion: 1,
      language: 'English',
      documentType: 'Reference note',
      summary: `Document contains the marker ${variables.documentText.match(/MARK_[A-Z0-9]+/)?.[0] || ''}.`,
      keyFacts: [variables.documentText.match(/MARK_[A-Z0-9]+/)?.[0] || ''].filter(Boolean),
    }),
    model: 'gpt-4o-mock',
  });
}

// MAX_ATTACHMENT_FILES is 5, so the 6 supported formats are exercised across
// two resolver calls per mode rather than one (Part 4 requires the file-count
// limit be preserved, not raised to fit the test).
async function runMarkerPipeline(mode, calendarId, calendarPostId, fixtureSubset) {
  const marker = 'MARK_' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const fixtures = fixtureSubset(buildFixtures(marker));
  const generateFn = makeEchoingGenerateFn();

  const records = [];
  for (const fx of fixtures) {
    const extraction = await extractCalendarAttachmentText({
      buffer: fx.buffer,
      fileName: fx.fileName,
      mimeType: fx.mimeType,
      sizeBytes: fx.buffer.length,
    });
    assert.ok(extraction.ok, `${fx.ext} extraction failed: ${extraction.error}`);
    assert.ok(extraction.extractedText.includes(marker), `${fx.ext} extracted text lost the marker`);

    const interpretation = await interpretCalendarAttachment({
      fileName: extraction.fileName,
      mimeType: extraction.mimeType,
      extractedText: extraction.extractedText,
      extractionStatus: extraction.extractionStatus,
      wasTruncated: extraction.wasTruncated,
      generateFn,
    });
    assert.ok(interpretation.ok, `${fx.ext} interpretation failed: ${interpretation.error}`);
    const ij = interpretation.interpretationJson;
    const foundInSummary = ij.summary.includes(marker);
    const foundInKeyFacts = (ij.keyFacts || []).some(k => k.includes(marker));
    assert.ok(foundInSummary || foundInKeyFacts, `${fx.ext} interpretation lost the marker`);

    records.push({
      id: `att-${fx.ext.slice(1)}-${marker}`,
      brandId: 'brand-e2e',
      calendarId,
      calendarPostId,
      purpose: mode === 'creation' ? 'calendar_reference_creation' : mode === 'calendar' ? 'calendar_reference' : 'calendar_post_regeneration_reference',
      fileName: fx.fileName,
      interpretationJson: ij,
      interpretationStatus: 'complete',
      expiresAt: null,
    });
  }

  const ids = records.map(r => r.id);
  const context = await resolveCalendarAttachmentContext({
    attachmentIds: ids,
    brandId: 'brand-e2e',
    mode,
    calendarId,
    calendarPostId,
    loadAttachmentsFn: async () => records,
  });

  assert.ok(context.ok, `resolver failed: ${context.error}`);
  return { context, marker, fixtures };
}

async function main() {
  const firstHalf = all => all.slice(0, 3);
  const secondHalf = all => all.slice(3);

  console.log('A. Marker survives full pipeline — calendar creation mode');
  for (const [label, subset] of [['txt/md/csv', firstHalf], ['json/pdf/docx', secondHalf]]) {
    await test(`unique marker from ${label} reaches the final prompt block (creation)`, async () => {
      const { context, marker, fixtures } = await runMarkerPipeline('creation', null, null, subset);
      for (const fx of fixtures) {
        assert.ok(context.block.includes(marker), `marker missing from creation block for ${fx.ext}`);
      }
    });
  }

  console.log('\nB. Marker survives full pipeline — post regeneration mode');
  for (const [label, subset] of [['txt/md/csv', firstHalf], ['json/pdf/docx', secondHalf]]) {
    await test(`unique marker from ${label} reaches the final prompt block (regeneration)`, async () => {
      const { context, marker, fixtures } = await runMarkerPipeline('post', 'cal-e2e', 'post-e2e', subset);
      for (const fx of fixtures) {
        assert.ok(context.block.includes(marker), `marker missing from regeneration block for ${fx.ext}`);
      }
    });
  }

  console.log('\nC. Regression guard — interpretation config failures are diagnosable, not generic');
  await test('missing PromptTemplate row surfaces as INTERPRETER_NOT_CONFIGURED, not a generic docx-looking error', async () => {
    const failingFn = async () => {
      throw new Error('Prompt template not found: "calendar-reference-attachment-interpreter"');
    };
    const result = await interpretCalendarAttachment({
      fileName: 'ref.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extractedText: 'Some extracted text.',
      extractionStatus: 'complete',
      wasTruncated: false,
      generateFn: failingFn,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INTERPRETER_NOT_CONFIGURED');
    assert.ok(!result.error.includes('calendar-reference-attachment-interpreter'), 'internal template slug leaked to client-facing error');
  });

  await test('missing OpenAI key surfaces as AI_NOT_CONFIGURED', async () => {
    const failingFn = async () => {
      const err = new Error('OPENAI_API_KEY is not configured. Add it in Settings or .env and restart the server.');
      err.code = 'AI_NOT_CONFIGURED';
      throw err;
    };
    const result = await interpretCalendarAttachment({
      fileName: 'ref.txt',
      mimeType: 'text/plain',
      extractedText: 'Some extracted text.',
      extractionStatus: 'complete',
      wasTruncated: false,
      generateFn: failingFn,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'AI_NOT_CONFIGURED');
  });

  console.log('\nD. Structured errors for unsupported / malformed input');
  await test('unsupported extension returns UNSUPPORTED_TYPE', async () => {
    const extraction = await extractCalendarAttachmentText({
      buffer: Buffer.from('hello'),
      fileName: 'ref.exe',
      mimeType: 'application/octet-stream',
      sizeBytes: 5,
    });
    assert.equal(extraction.ok, false);
    assert.equal(extraction.code, 'UNSUPPORTED_TYPE');
  });

  await test('malformed DOCX (renamed garbage) returns a structured error, not a throw', async () => {
    const extraction = await extractCalendarAttachmentText({
      buffer: Buffer.from('not a real docx file'),
      fileName: 'ref.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 21,
    });
    assert.equal(extraction.ok, false);
    assert.equal(extraction.code, 'INVALID_DOCX');
  });

  await test('valid text file with only whitespace returns NO_TEXT_EXTRACTED, not a generic failure', async () => {
    const extraction = await extractCalendarAttachmentText({
      buffer: Buffer.from('   \n\t  \n  ', 'utf-8'),
      fileName: 'ref.txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
    });
    assert.equal(extraction.ok, false);
    assert.equal(extraction.code, 'NO_TEXT_EXTRACTED');
    assert.equal(extraction.error, 'No readable text could be extracted from this file.');
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
