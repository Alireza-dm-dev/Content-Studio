"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { parseApiResponse, getApiErrorMessage } from "@/lib/http";
import { lbl, inkBtn, primaryBtn, fmtStamp, errMessage } from "./brand-forum/forum-ui";

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.json";
const MAX_BYTES = 15 * 1024 * 1024;

const STATUS_LABEL = { READY: "Ready", PROCESSING: "Processing", FAILED: "Failed" };
const STATUS_COLOR = {
  READY: "var(--sketch-ink)",
  PROCESSING: "var(--sketch-ink-faint)",
  FAILED: "var(--sketch-vermilion)",
};

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function typeLabel(name) {
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return ext ? ext.toUpperCase() : "FILE";
}

export default function BrandKnowledgeSection({ brandId }) {
  const base = `/api/brands/${brandId}/knowledge`;
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState([]); // file names currently in flight
  const [confirmId, setConfirmId] = useState(null);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    const res = await fetch(base);
    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(getApiErrorMessage(data));
    return data.documents;
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => !cancelled && setDocs(d))
      .catch((err) => !cancelled && setLoadError(errMessage(err, "Failed to load documents.")))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [load]);

  async function uploadOne(file, desc) {
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name}: file exceeds the 15 MB limit`);
      return;
    }
    setUploading((u) => [...u, file.name]);
    try {
      const form = new FormData();
      form.append("file", file);
      if (desc) form.append("description", desc);
      const res = await fetch(base, { method: "POST", body: form });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data));
      setDocs((prev) => [data.document, ...prev]);
      if (data.document.status === "FAILED") toast.error(`${file.name}: ${data.document.extractionError}`);
      else toast.success(`${file.name} added to brand knowledge`);
    } catch (err) {
      toast.error(`${file.name}: ${errMessage(err, "Upload failed")}`);
    } finally {
      setUploading((u) => u.filter((n) => n !== file.name));
    }
  }

  async function onPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const desc = description.trim();
    setDescription("");
    for (const f of files) await uploadOne(f, desc); // sequential: extraction runs inside each request
  }

  async function remove(id) {
    setConfirmId(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "DELETE" });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data));
      setDocs((prev) => prev.filter((d) => d.id !== id));
      toast.success("Document removed");
    } catch (err) {
      toast.error(errMessage(err, "Failed to delete document"));
    }
  }

  const busy = uploading.length > 0;

  return (
    <div style={{ border: "1px solid var(--sketch-line)", background: "var(--sketch-paper-bright)", marginBottom: 24 }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--sketch-line-soft)", ...lbl, color: "var(--sketch-ink)" }}>
        Brand Knowledge
      </div>
      <div style={{ padding: "16px 18px" }}>
        <p style={{ ...lbl, textTransform: "none", letterSpacing: 0, fontSize: 11, margin: "0 0 12px" }}>
          Upload documents Content Studio can use as source material for this brand. Relevant excerpts are
          used as brand knowledge when creating content, answering questions and writing prompts.
          PDF, DOCX, TXT, MD, CSV or JSON · up to 15 MB each · up to 30 documents.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder="Optional: what is this document for? (e.g. 2026 pricing and offer rules)"
            aria-label="Document purpose (optional)"
            style={{ flex: "1 1 260px", fontFamily: "var(--font-mono-ink)", fontSize: 12, padding: "6px 10px", border: "1px solid var(--sketch-line)", background: "var(--sketch-paper-bright)", color: "var(--sketch-ink)" }}
          />
          <input ref={fileInput} type="file" multiple accept={ACCEPT} onChange={onPick} style={{ display: "none" }} />
          <button type="button" style={primaryBtn} disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? "Processing…" : "+ Add document"}
          </button>
        </div>

        {loading && <div style={lbl}>Loading…</div>}
        {loadError && <div style={{ ...lbl, color: "var(--sketch-vermilion)" }}>{loadError}</div>}
        {!loading && !loadError && docs.length === 0 && uploading.length === 0 && (
          <div style={lbl}>No documents yet.</div>
        )}

        {uploading.map((name) => (
          <div key={`up-${name}`} style={{ padding: "10px 0", borderTop: "1px solid var(--sketch-line-soft)" }}>
            <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12 }}>{name}</div>
            <div style={{ ...lbl, marginTop: 3 }}>{typeLabel(name)} · Processing — extracting text…</div>
          </div>
        ))}

        {docs.map((d) => (
          <div key={d.id} style={{ padding: "10px 0", borderTop: "1px solid var(--sketch-line-soft)", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, fontWeight: 500, color: "var(--sketch-ink)", wordBreak: "break-word" }}>
                {d.displayName}
              </div>
              <div style={{ ...lbl, marginTop: 3 }}>
                {typeLabel(d.originalFileName)} · {fmtSize(d.fileSize)} ·{" "}
                <span style={{ color: STATUS_COLOR[d.status] }}>{STATUS_LABEL[d.status] ?? d.status}</span>
                {d.status === "READY" && " · Used as brand knowledge"}
              </div>
              <div style={{ ...lbl, marginTop: 2 }}>
                {d.uploadedByName ? `Uploaded by ${d.uploadedByName} · ` : ""}{fmtStamp(d.createdAt)}
              </div>
              {d.description && (
                <div style={{ ...lbl, textTransform: "none", letterSpacing: 0, fontSize: 11, marginTop: 4 }}>{d.description}</div>
              )}
              {d.status === "READY" && d.wasTruncated && (
                <div style={{ ...lbl, marginTop: 4 }}>Very long document — only the first 200,000 characters are used.</div>
              )}
              {d.status === "FAILED" && (
                <div style={{ ...lbl, textTransform: "none", letterSpacing: 0, fontSize: 11, marginTop: 4, color: "var(--sketch-vermilion)" }}>
                  {d.extractionError || "Could not extract text."} This document is not used by AI. Delete it and upload a readable version.
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0 }}>
              {confirmId === d.id ? (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button type="button" style={primaryBtn} onClick={() => remove(d.id)}>Confirm</button>
                  <button type="button" style={inkBtn} onClick={() => setConfirmId(null)}>Cancel</button>
                </span>
              ) : (
                <button type="button" style={inkBtn} onClick={() => setConfirmId(d.id)}>Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
