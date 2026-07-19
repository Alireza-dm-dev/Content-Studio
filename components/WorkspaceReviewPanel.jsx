"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { SectionLabel } from "@/components/content-report/SectionLabel";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const inkBtn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const overlayBackdrop = {
  position: "fixed", inset: 0, zIndex: 999,
  background: "rgba(28,24,18,0.35)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const modalBox = {
  background: "var(--sketch-paper-bright)",
  border: "1px solid var(--sketch-line)",
  boxShadow: "4px 4px 0 rgba(28,24,18,0.12)",
  padding: "24px", maxWidth: 480, width: "90%",
  maxHeight: "85vh", overflowY: "auto",
  position: "relative",
};

function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return "\u2014";
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return "\u2014";
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "\u2014";
  }
}

function reviewStatusColor(status) {
  if (status === "active") return "var(--sketch-sage)";
  if (status === "expired") return "var(--sketch-stone)";
  return "var(--sketch-vermilion)";
}

function ReviewStatusBadge({ status }) {
  return (
    <span style={{
      ...lbl, fontSize: 9, color: reviewStatusColor(status),
      border: `1px solid ${reviewStatusColor(status)}`,
      padding: "1px 6px", letterSpacing: "0.1em",
    }}>
      {status}
    </span>
  );
}

function ReviewManagementModal({
  review, reviewUrl, onClose, onRegenerate, regenerating, brandId,
}) {
  const [copied, setCopied] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  function handleKeyDown(e) {
    if (e.key === "Escape" && !regenerating) onClose();
  }

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  async function handleCopy() {
    if (!reviewUrl) return;
    try {
      await navigator.clipboard.writeText(reviewUrl);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Copy failed");
    }
  }

  function handleOpen() {
    if (!reviewUrl) return;
    window.open(reviewUrl, "_blank", "noopener,noreferrer");
  }

  function handleRegenerateClick() {
    if (regenerating) return;
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);
    onRegenerate(review.id);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget && !regenerating) onClose();
  }

  const showUrl = Boolean(reviewUrl);
  const confirmStep = showConfirm && !showUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
      style={overlayBackdrop}
      onClick={handleBackdropClick}
    >
      <div style={modalBox}>
        {/* Title */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div id="review-modal-title">
            <div style={{
              fontFamily: "var(--font-mono-ink)", fontSize: 11, fontWeight: 500,
              color: "var(--sketch-ink)",
            }}>
              {review.label || "Untitled"}
            </div>
            <ReviewStatusBadge status={review.status} />
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            disabled={regenerating}
            style={{
              ...inkBtn, border: "none", fontSize: 14, padding: "2px 6px",
              opacity: regenerating ? 0.4 : 1,
            }}
          >
            \u2715
          </button>
        </div>

        {/* Details */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          <DetailRow label="Token" value={`...${review.tokenLast4}`} />
          <DetailRow label="Status" value={review.status} />
          <DetailRow label="Expires" value={review.expiresAt ? formatDateTime(review.expiresAt) : "Never"} />
          <DetailRow label="Sections" value={
            [review.includeCalendars && "Calendars",
             review.includeInstagram && "Instagram",
             review.includeLinkedIn && "LinkedIn"].filter(Boolean).join(", ") || "None"
          } />
          <DetailRow label="Comments" value={review.allowComments ? "Enabled" : "Disabled"} />
        </div>

        {/* URL section */}
        {showUrl && (
          <div style={{
            border: "1px solid var(--sketch-line)", padding: "10px 14px", marginBottom: 16,
            background: "var(--sketch-paper-bright)",
          }}>
            <div style={{ ...lbl, fontSize: 9, marginBottom: 6 }}>Review URL</div>
            <div style={{
              fontFamily: "var(--font-mono-ink)", fontSize: 10,
              color: "var(--sketch-ink)", wordBreak: "break-all", lineHeight: 1.5,
            }}>
              {reviewUrl}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {showUrl && (
            <>
              <button onClick={handleOpen} style={{
                ...inkBtn, borderColor: "var(--sketch-vermilion)",
                color: "var(--sketch-vermilion)",
              }}>
                Open Review
              </button>
              <button onClick={handleCopy} style={{
                ...inkBtn, borderColor: "var(--sketch-vermilion)",
                color: "var(--sketch-vermilion)",
              }}>
                {copied ? "Copied" : "Copy Link"}
              </button>
            </>
          )}

          {!showUrl && !confirmStep && (
            <>
              <div style={{
                width: "100", ...lbl, fontSize: 9, lineHeight: 1.4, marginBottom: 4,
              }}>
                For security, the complete review URL is only shown when created or regenerated.
              </div>
              <button onClick={handleRegenerateClick} disabled={regenerating} style={{
                ...inkBtn, borderColor: "var(--sketch-vermilion)",
                color: "var(--sketch-vermilion)",
                opacity: regenerating ? 0.5 : 1,
              }}>
                {regenerating ? "Regenerating\u2026" : "Regenerate Link"}
              </button>
            </>
          )}

          {confirmStep && (
            <div style={{
              border: "1px solid var(--sketch-vermilion)", padding: "12px",
              background: "var(--sketch-paper-bright)", width: "100%",
            }}>
              <div style={{ ...lbl, color: "var(--sketch-vermilion)", marginBottom: 8, fontSize: 9 }}>
                Regenerating invalidates the previous shared link.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleRegenerateClick} disabled={regenerating} style={{
                  ...inkBtn, borderColor: "var(--sketch-vermilion)",
                  background: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)",
                  opacity: regenerating ? 0.5 : 1,
                }}>
                  {regenerating ? "Regenerating\u2026" : "Confirm Regenerate"}
                </button>
                <button onClick={() => setShowConfirm(false)} style={inkBtn}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 8, ...lbl, fontSize: 9 }}>
      <span style={{ flexShrink: 0, color: "var(--sketch-ink-faint)", minWidth: 64 }}>{label}</span>
      <span style={{ color: "var(--sketch-ink-soft)" }}>{value}</span>
    </div>
  );
}

export default function WorkspaceReviewPanel({ brandId }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newLink, setNewLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [reviewUrls, setReviewUrls] = useState({});
  const [modalReview, setModalReview] = useState(null);
  const [regenerating, setRegenerating] = useState(false);

  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [includeCalendars, setIncludeCalendars] = useState(true);
  const [includeInstagram, setIncludeInstagram] = useState(true);
  const [includeLinkedIn, setIncludeLinkedIn] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch(`/api/brands/${brandId}/reviews`);
      if (res.ok) {
        const data = await res.json();
        setReviews(data.reviews || []);
      }
    } catch {
      // silently fail
    }
  }, [brandId]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        await fetchReviews();
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [fetchReviews]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!includeCalendars && !includeInstagram && !includeLinkedIn) {
      toast.error("Select at least one content section.");
      return;
    }
    setCreating(true);
    try {
      const body = {
        label: label.trim() || null,
        includeCalendars,
        includeInstagram,
        includeLinkedIn,
      };
      if (expiresAt) {
        body.expiresAt = new Date(expiresAt).toISOString();
      }

      const res = await fetch(`/api/brands/${brandId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create review link");
      }
      const data = await res.json();

      const fullUrl = `${window.location.origin}${data.reviewPath}`;
      setReviewUrls((prev) => ({ ...prev, [data.review.id]: fullUrl }));
      setNewLink(data);
      setShowCreateForm(false);
      toast.success("Review link created!");
      await fetchReviews();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyLink() {
    if (!newLink) return;
    const fullUrl = `${window.location.origin}${newLink.reviewPath}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      toast.success("Review link copied!");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("Failed to copy link.");
    }
  }

  function handleDismissNew() {
    setNewLink(null);
    setCopied(false);
  }

  function resetForm() {
    setLabel("");
    setExpiresAt("");
    setIncludeCalendars(true);
    setIncludeInstagram(true);
    setIncludeLinkedIn(true);
    setShowCreateForm(true);
  }

  function handleRowClick(review) {
    setModalReview(review);
  }

  function handleRowKeyDown(e, review) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setModalReview(review);
    }
  }

  function handleCloseModal() {
    if (regenerating) return;
    setModalReview(null);
  }

  async function handleRegenerate(reviewId) {
    setRegenerating(true);
    try {
      const res = await fetch(
        `/api/brands/${brandId}/reviews/${reviewId}/regenerate-token`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to regenerate link");
      }
      const data = await res.json();

      const fullUrl = `${window.location.origin}${data.reviewPath}`;
      setReviewUrls((prev) => ({ ...prev, [reviewId]: fullUrl }));
      setReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? data.review : r)),
      );
      setModalReview(data.review);
      toast.success("Link regenerated");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRegenerating(false);
    }
  }

  const modalReviewUrl = modalReview ? reviewUrls[modalReview.id] : null;

  return (
    <section style={{ marginTop: 36 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <SectionLabel meta={`${reviews.length} total`}>Review Links</SectionLabel>
        {!showCreateForm && !newLink && (
          <button onClick={resetForm} style={{
            ...inkBtn, borderColor: "var(--sketch-vermilion)",
            background: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)",
          }}>
            + New Review Link
          </button>
        )}
      </div>

      <div style={{ ...lbl, marginBottom: 16, lineHeight: 1.5 }}>
        Share a read-only workspace view with reviewers via a unique link.
      </div>

      {/* New link created */}
      {newLink && (
        <div style={{
          border: "1px solid var(--sketch-sage)", padding: "14px 18px",
          background: "var(--sketch-paper-bright)", marginBottom: 16,
          boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        }}>
          <div style={{ ...lbl, color: "var(--sketch-sage)", marginBottom: 8 }}>
            Review link created
          </div>
          <div style={{
            fontFamily: "var(--font-mono-ink)", fontSize: 11, color: "var(--sketch-ink)",
            wordBreak: "break-all", lineHeight: 1.5, marginBottom: 10,
          }}>
            {window.location.origin}{newLink.reviewPath}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCopyLink} style={{
              ...inkBtn, borderColor: "var(--sketch-vermilion)",
              color: "var(--sketch-vermilion)",
            }}>
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button onClick={handleDismissNew} style={inkBtn}>Done</button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreateForm && !newLink && (
        <div style={{
          border: "1px solid var(--sketch-line)", padding: "14px 18px",
          background: "var(--sketch-paper-bright)", marginBottom: 16,
          boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        }}>
          <div style={{ ...lbl, marginBottom: 12 }}>New Review Link</div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Label (optional)</div>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Client review v2"
              maxLength={120}
              style={inputStyle(lbl)}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Expires (optional)</div>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              style={inputStyle(lbl)}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Sections</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <ToggleCheckbox label="Calendars" checked={includeCalendars} onChange={setIncludeCalendars} />
              <ToggleCheckbox label="Instagram" checked={includeInstagram} onChange={setIncludeInstagram} />
              <ToggleCheckbox label="LinkedIn" checked={includeLinkedIn} onChange={setIncludeLinkedIn} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setShowCreateForm(false)} style={inkBtn}>Cancel</button>
            <button onClick={handleCreate} disabled={creating} style={{
              ...inkBtn, borderColor: "var(--sketch-vermilion)",
              background: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)",
              opacity: creating ? 0.5 : 1,
            }}>
              {creating ? "Creating\u2026" : "Create Link"}
            </button>
          </div>
        </div>
      )}

      {/* Review list */}
      {loading && (
        <div style={{ padding: "20px 0", textAlign: "center", ...lbl }}>
          Loading review links\u2026
        </div>
      )}

      {!loading && reviews.length === 0 && !showCreateForm && !newLink && (
        <div style={{
          border: "2px dashed var(--sketch-line)", padding: "24px 0", textAlign: "center",
        }}>
          <div style={{
            fontFamily: "var(--font-mono-ink)", fontSize: 12, fontWeight: 500,
            color: "var(--sketch-ink-faint)", marginBottom: 6,
          }}>
            No review links yet
          </div>
          <div style={{
            fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13,
            color: "var(--sketch-ink-faint)",
          }}>
            Share read-only workspace content with external reviewers.
          </div>
        </div>
      )}

      {reviews.length > 0 && (
        <div>
          {reviews.map((r) => (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              aria-label={`Review link: ${r.label || "Untitled"}`}
              onClick={() => handleRowClick(r)}
              onKeyDown={(e) => handleRowKeyDown(e, r)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                border: "1px solid var(--sketch-line)",
                background: "var(--sketch-paper-bright)",
                boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
                padding: "10px 14px", marginBottom: 8,
                cursor: "pointer",
              }}
            >
              <div style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: reviewStatusColor(r.status),
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontFamily: "var(--font-mono-ink)", fontSize: 11, color: "var(--sketch-ink)",
                    fontWeight: 500,
                  }}>
                    {r.label || "Untitled"}
                  </span>
                  <ReviewStatusBadge status={r.status} />
                  <span style={{ ...lbl, fontSize: 8 }}>
                    ...{r.tokenLast4}
                  </span>
                  {reviewUrls[r.id] && (
                    <span style={{ ...lbl, fontSize: 8, color: "var(--sketch-sage)" }}>
                      URL available
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 3, ...lbl, fontSize: 8 }}>
                  {r.includeCalendars && <span>Calendars</span>}
                  {r.includeInstagram && <span>Instagram</span>}
                  {r.includeLinkedIn && <span>LinkedIn</span>}
                  {r.expiresAt && <span>Expires: {formatDate(r.expiresAt)}</span>}
                  {!r.expiresAt && <span>No expiry</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Management modal */}
      {modalReview && (
        <ReviewManagementModal
          review={modalReview}
          reviewUrl={modalReviewUrl}
          brandId={brandId}
          regenerating={regenerating}
          onClose={handleCloseModal}
          onRegenerate={handleRegenerate}
        />
      )}
    </section>
  );
}

function ToggleCheckbox({ label, checked, onChange }) {
  return (
    <label style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontFamily: "var(--font-mono-ink)", fontSize: 10, color: "var(--sketch-ink-soft)",
      cursor: "pointer",
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--sketch-vermilion)" }}
      />
      {label}
    </label>
  );
}

function inputStyle(lbl) {
  return {
    width: "100%",
    padding: "6px 10px",
    fontFamily: "var(--font-mono-ink)",
    fontSize: 11,
    color: "var(--sketch-ink)",
    background: "var(--sketch-paper-bright)",
    border: "1px solid var(--sketch-line)",
    borderRadius: 0,
    outline: "none",
    boxSizing: "border-box",
  };
}
