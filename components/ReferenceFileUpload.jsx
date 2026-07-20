"use client";

import { useState, useRef, useId } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X, AlertCircle, FileText, Clock } from "lucide-react";

const ACCEPTED_EXTENSIONS = ".txt,.md,.markdown,.csv,.json";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES_DEFAULT = 5;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedFile(file) {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.split(",").some(ext => name.endsWith(ext));
}

function StatusBadge({ status }) {
  if (!status) return null;
  const colors = {
    complete: "text-green-600 dark:text-green-400",
    pending: "text-amber-600 dark:text-amber-400",
    processing: "text-blue-600 dark:text-blue-400",
    failed: "text-destructive",
  };
  return (
    <span className={`text-xs ${colors[status] || "text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function ReferenceFileUpload({
  brandId,
  attachments = [],
  onAttachmentsChange,
  disabled = false,
  maxFiles = MAX_FILES_DEFAULT,
  title = "Reference Files",
  description = "Upload campaign briefs, content guidelines, or reference documents to help the AI generate more relevant post ideas.",
  calendarId = null,
  calendarPostId = null,
  allowRemove = true,
}) {
  const [uploads, setUploads] = useState([]);
  const [dropActive, setDropActive] = useState(false);
  const [globalError, setGlobalError] = useState(null);
  const fileInputRef = useRef(null);
  const inputId = useId();

  const hasActiveUploads = uploads.some(
    u => u.state === "queued" || u.state === "uploading" || u.state === "interpreting"
  );
  const cannotInteract = disabled || hasActiveUploads;
  const remainingSlots = maxFiles - attachments.length;

  function fileKey(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  function isDuplicate(file) {
    const key = fileKey(file);
    if (attachments.some(a => a.name === file.name && a.sizeBytes === file.size)) return true;
    if (uploads.some(u => fileKey(u.file) === key)) return true;
    return false;
  }

  function validateFiles(fileList) {
    setGlobalError(null);
    const files = Array.from(fileList);
    const errors = [];

    if (!brandId) {
      errors.push("Select a Brand before uploading files.");
      return { valid: [], errors };
    }

    if ((calendarId && !calendarPostId) || (!calendarId && calendarPostId)) {
      errors.push("Calendar and post information are required for this upload.");
      return { valid: [], errors };
    }

    if (attachments.length >= maxFiles) {
      errors.push(`A maximum of ${maxFiles} files is allowed.`);
      return { valid: [], errors };
    }

    let slotsLeft = remainingSlots;

    for (const file of files) {
      if (slotsLeft <= 0) {
        errors.push(`A maximum of ${maxFiles} files is allowed.`);
        break;
      }
      if (file.size === 0) {
        errors.push(`"${file.name}" is empty.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`"${file.name}" exceeds the 5 MB limit.`);
        continue;
      }
      if (!isSupportedFile(file)) {
        errors.push(`"${file.name}" has an unsupported file type.`);
        continue;
      }
      if (isDuplicate(file)) {
        errors.push(`"${file.name}" has already been added.`);
        continue;
      }
      slotsLeft--;
    }

    const validFiles = [];
    const usedKeys = new Set();
    for (const file of files) {
      if (errors.some(e => e.includes(file.name))) continue;
      const key = fileKey(file);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      validFiles.push(file);
    }

    return { valid: validFiles.slice(0, remainingSlots), errors };
  }

  async function handleFiles(fileList) {
    if (cannotInteract) return;
    const { valid, errors } = validateFiles(fileList);

    if (errors.length > 0) {
      setGlobalError(errors.join(". "));
      setTimeout(() => setGlobalError(null), 5000);
    }

    if (valid.length === 0) return;

    const newUploads = valid.map(file => ({
      localId: crypto.randomUUID(),
      file,
      state: "queued",
      error: null,
    }));

    setUploads(prev => [...prev, ...newUploads]);

    await Promise.all(newUploads.map(entry => uploadFile(entry)));
  }

  async function uploadFile(entry) {
    setUploads(prev =>
      prev.map(u =>
        u.localId === entry.localId ? { ...u, state: "uploading" } : u
      )
    );

    const formData = new FormData();
    formData.append("file", entry.file);
    if (calendarId && calendarPostId) {
      formData.append("calendarId", calendarId);
      formData.append("calendarPostId", calendarPostId);
    }

    try {
      const res = await fetch(
        `/api/brands/${encodeURIComponent(brandId)}/attachments`,
        { method: "POST", body: formData }
      );

      const data = await res.json();

      if (!res.ok || data.success !== true) {
        const msg = data.error || "File could not be uploaded.";
        setUploads(prev =>
          prev.map(u =>
            u.localId === entry.localId ? { ...u, state: "failed", error: msg } : u
          )
        );
        return;
      }

      if (!data.attachment?.id) {
        setUploads(prev =>
          prev.map(u =>
            u.localId === entry.localId
              ? { ...u, state: "failed", error: "File could not be uploaded." }
              : u
          )
        );
        return;
      }

      onAttachmentsChange([...attachments, data.attachment]);
      setUploads(prev => prev.filter(u => u.localId !== entry.localId));
    } catch {
      setUploads(prev =>
        prev.map(u =>
          u.localId === entry.localId
            ? { ...u, state: "failed", error: "File could not be uploaded." }
            : u
        )
      );
    }
  }

  function handleRemove(attachmentId, fileName) {
    if (disabled || !allowRemove) return;
    onAttachmentsChange(attachments.filter(a => a.id !== attachmentId));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDropActive(false);
    if (cannotInteract) return;
    handleFiles(e.dataTransfer.files);
  }

  function handleDragOver(e) {
    e.preventDefault();
    if (!cannotInteract) setDropActive(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDropActive(false);
  }

  function handleBrowse() {
    if (cannotInteract) return;
    fileInputRef.current?.click();
  }

  function handleInputChange(e) {
    if (e.target.files?.length) {
      handleFiles(e.target.files);
    }
    e.target.value = "";
  }

  function statusIcon(state) {
    switch (state) {
      case "queued":
        return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
      case "uploading":
      case "interpreting":
        return <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />;
      case "failed":
        return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
      default:
        return null;
    }
  }

  return (
    <div className="border border-sketch-line bg-[var(--sketch-paper-bright)]">
      <div className="px-[18px] py-[12px] border-b border-[var(--sketch-line-soft)]">
        <span className="label-sketch">{title}</span>
      </div>
      <div className="px-[18px] py-4 space-y-4">
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg px-6 py-8 transition-colors ${
            cannotInteract
              ? "border-muted-foreground/20 bg-muted/10 cursor-not-allowed opacity-50"
              : dropActive
                ? "border-primary bg-primary/5 cursor-pointer"
                : "border-muted-foreground/30 hover:border-foreground/40 hover:bg-muted/20 cursor-pointer"
          }`}
        >
          <Upload className="w-6 h-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground text-center">
            {cannotInteract ? (
              "Uploading is currently disabled"
            ) : (
              <>
                Drop files here or{" "}
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="text-primary underline hover:no-underline"
                >
                  browse
                </button>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Supported: .txt, .md, .csv, .json
          </p>
          <p className="text-xs text-muted-foreground">
            Up to {maxFiles} files, max 5 MB each
          </p>
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleInputChange}
            className="hidden"
            disabled={cannotInteract}
            aria-hidden="true"
          />
        </div>

        {globalError && (
          <div
            className="flex items-start gap-2 text-xs text-destructive"
            role="alert"
            aria-live="polite"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{globalError}</span>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="space-y-2" aria-live="polite">
            {uploads.map(entry => (
              <div
                key={entry.localId}
                className="flex items-center gap-2 text-xs border border-sketch-line bg-muted/20 px-3 py-2"
              >
                {statusIcon(entry.state)}
                <span className="flex-1 min-w-0 truncate">
                  {entry.file.name}
                </span>
                {entry.state === "queued" ||
                entry.state === "uploading" ||
                entry.state === "interpreting" ? (
                  <span className="text-muted-foreground shrink-0">
                    Uploading and interpreting…
                  </span>
                ) : entry.state === "failed" ? (
                  <span
                    className="text-destructive shrink-0 max-w-[200px] truncate"
                    title={entry.error}
                  >
                    {entry.error}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="space-y-2">
            {attachments.map(att => (
              <div
                key={att.id}
                className="flex items-start gap-3 border border-sketch-line bg-muted/10 px-[14px] py-3"
              >
                <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {att.name}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatSize(att.sizeBytes)}
                    </span>
                    {att.documentType && (
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {att.documentType}
                      </span>
                    )}
                  </div>
                  {att.summary && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {att.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap pt-0.5">
                    <StatusBadge status={att.extractionStatus} />
                    <StatusBadge status={att.interpretationStatus} />
                    {att.wasTruncated && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                        Truncated
                      </span>
                    )}
                    {att.expiresAt && (
                      <span className="text-xs text-muted-foreground">
                        Temporary reference · available until {new Date(att.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
                {allowRemove && (
                  <button
                    type="button"
                    onClick={() => handleRemove(att.id, att.name)}
                    disabled={disabled}
                    className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label={`Remove ${att.name}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {remainingSlots > 0 && !cannotInteract && (
          <p className="text-xs text-muted-foreground">
            {remainingSlots} of {maxFiles} slot{remainingSlots !== 1 ? "s" : ""}{" "}
            remaining
          </p>
        )}
      </div>
    </div>
  );
}

export { ReferenceFileUpload };
