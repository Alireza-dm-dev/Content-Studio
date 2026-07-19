"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ImageIcon, Loader2, Upload, Trash2, AlertCircle } from "lucide-react";

// Reusable final-step "Reference Image for Generation" upload + description input.
// Used by the calendar-post ImagePromptModal and the create-image flows
// (raw-idea, from-brand, reference-flow) before the OpenAI/Higgsfield cards.
//
// Controlled component: parent owns referenceImageUrl + referenceImageDescription.
// This component handles uploading to /api/upload/temp-image and local preview state.
export default function GenerationReferenceImageInput({
  referenceImageUrl,
  setReferenceImageUrl,
  referenceImageDescription,
  setReferenceImageDescription,
  disabled = false,
}) {
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState(null);
  const [uploadFileName, setUploadFileName] = useState(null);
  const [uploadFileSize, setUploadFileSize] = useState(null);
  const [uploadImageError, setUploadImageError] = useState(null);

  async function handleUploadReferenceImage(file) {
    if (!file) return;
    setUploadImageError(null);
    setUploadingImage(true);

    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/temp-image", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ success: false, error: "Invalid server response." }));
      if (!data.success) {
        setUploadImageError(data.error ?? "Upload failed.");
        return;
      }
      setReferenceImageUrl(data.filePath);
      setUploadFileName(data.fileName);
      setUploadFileSize(data.fileSize);
    } catch (err) {
      console.error("[GenerationReferenceImageInput] upload error:", err);
      setUploadImageError("Upload failed. Please try again.");
    } finally {
      setUploadingImage(false);
    }
  }

  function handleClearReferenceImage() {
    setReferenceImageUrl(null);
    setReferenceImageDescription("");
    setUploadPreviewUrl(null);
    setUploadFileName(null);
    setUploadFileSize(null);
    setUploadImageError(null);
  }

  function handleReferenceFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadPreviewUrl(URL.createObjectURL(f));
    setUploadFileName(f.name);
    setUploadFileSize(f.size);
    handleUploadReferenceImage(f);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
        Reference Image for Generation
      </p>
      <p className="text-xs text-muted-foreground">
        Optional. Upload one image, such as a logo or product photo, and explain how it should appear in the generated image.
      </p>

      {/* Upload area */}
      {!referenceImageUrl && !uploadingImage && !disabled && (
        <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border hover:border-primary/40 transition-colors py-6 cursor-pointer">
          <Upload className="w-5 h-5 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">Click to upload</p>
            <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG, WEBP — max 10 MB</p>
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleReferenceFileSelect}
          />
        </label>
      )}

      {/* Upload loading */}
      {uploadingImage && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Uploading reference image…
        </div>
      )}

      {/* Upload error */}
      {uploadImageError && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {uploadImageError}
        </div>
      )}

      {/* Preview + clear */}
      {referenceImageUrl && (
        <div className="flex items-start gap-3">
          {uploadPreviewUrl && (
            <img
              src={uploadPreviewUrl}
              alt="Reference preview"
              className="w-20 h-20 rounded-lg object-cover border border-border shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{uploadFileName || "Uploaded image"}</p>
            {uploadFileSize && (
              <p className="text-xs text-muted-foreground">{(uploadFileSize / 1024).toFixed(0)} KB</p>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={handleClearReferenceImage}
                className="inline-flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 mt-1 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground block">
          How should this image be used?
          <span className="ml-1 font-normal text-muted-foreground/60">(optional)</span>
        </label>
        <textarea
          value={referenceImageDescription}
          onChange={e => setReferenceImageDescription(e.target.value)}
          placeholder="Place this logo in the top-right corner without changing its colors or shape."
          rows={2}
          disabled={disabled}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-y"
        />
      </div>
    </div>
  );
}
