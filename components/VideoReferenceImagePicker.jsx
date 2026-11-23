"use client";

// Optional FIRST FRAME / REFERENCE IMAGE picker for Create Video Prompt — Raw Idea.
// The file stays in the browser until "Generate" sends it with the request; the
// preview is a local object URL, nothing is uploaded on selection. The server
// re-validates everything (extension, MIME, signature, size).

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImagePlus, RefreshCw, X } from "lucide-react";

export const REFERENCE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;
const OK_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const OK_EXT = /\.(jpe?g|png|webp)$/i;

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side pre-check only; returns an error string or null. */
export function checkReferenceFile(file) {
  if (!file) return "No file selected.";
  if (!OK_EXT.test(file.name || "") || !OK_TYPES.has(file.type)) {
    return "Reference image must be a JPG, PNG or WebP file.";
  }
  if (file.size === 0) return "Reference image is empty.";
  if (file.size > MAX_BYTES) return "Reference image is too large. Maximum is 10 MB.";
  return null;
}

export default function VideoReferenceImagePicker({ file, onChange, disabled }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null); // { file, url }
  const [error, setError] = useState(null);
  const urlRef = useRef(null);

  function setPreviewFor(next) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next ? URL.createObjectURL(next) : null;
    setPreview(next ? { file: next, url: urlRef.current } : null);
  }

  // Release the object URL when the picker unmounts.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const previewUrl = preview && preview.file === file ? preview.url : null;

  function openPicker() {
    inputRef.current?.click();
  }

  function handleSelect(e) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after Remove
    if (!picked) return;
    const problem = checkReferenceFile(picked);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setPreviewFor(picked);
    onChange(picked);
  }

  function handleRemove() {
    setError(null);
    setPreviewFor(null);
    onChange(null);
  }

  return (
    <div className="space-y-1.5" data-testid="reference-image-picker">
      <Label htmlFor="referenceImage">
        First frame / reference image <span className="text-muted-foreground font-normal">— optional</span>
      </Label>
      <p className="text-xs text-muted-foreground">
        This image will be treated as the opening frame / visual reference when creating the video
        prompt. The prompt will start from what is visible in it; you still generate the video in
        your chosen video tool.
      </p>

      <input
        ref={inputRef}
        id="referenceImage"
        type="file"
        accept={REFERENCE_ACCEPT}
        className="sr-only"
        onChange={handleSelect}
        disabled={disabled}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/10 p-2">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img
              src={previewUrl}
              alt="Reference frame preview"
              className="h-20 w-20 flex-shrink-0 rounded object-cover border border-border"
            />
          ) : (
            <div className="h-20 w-20 flex-shrink-0 rounded border border-border bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm" title={file.name}>{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(file.size)} · used as the opening frame
            </p>
          </div>
          <div className="flex flex-shrink-0 gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={openPicker} disabled={disabled} className="gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Replace
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleRemove} disabled={disabled} className="gap-1">
              <X className="w-3.5 h-3.5" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={openPicker} disabled={disabled} className="gap-2">
          <ImagePlus className="w-4 h-4" /> Upload reference image
        </Button>
      )}

      <p className="text-xs text-muted-foreground">JPG, PNG or WebP · up to 10 MB</p>
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
