"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, CheckCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_VARIANT = {
  draft: "secondary",
  ready_for_review: "warning",
  approved: "default",
  active: "default",
  completed: "outline",
};

export function PortalCalendarDetailWrapper({ calendar, children }) {
  const [calStatus, setCalStatus] = useState(calendar.status);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmitForReview() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/calendars/${calendar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ready_for_review" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit for review.");
      }
      setCalStatus("ready_for_review");
      toast.success("Calendar submitted for review.");
    } catch (err) {
      toast.error(err.message ?? "Could not submit calendar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          marginBottom: 16,
          borderRadius: 4,
          border: "1px solid var(--sketch-line)",
          background: "var(--sketch-paper-bright)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--sketch-ink-faint)",
          }}
        >
          Status
        </div>
        <Badge variant={STATUS_VARIANT[calStatus] ?? "outline"} className="text-xs capitalize">
          {calStatus === "ready_for_review" ? "Ready for Review" : calStatus}
        </Badge>
        <div style={{ flex: 1 }} />
        {calStatus === "draft" && (
          <Button
            size="sm"
            onClick={handleSubmitForReview}
            disabled={submitting}
            className="gap-1.5"
          >
            {submitting ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Submitting…</>
            ) : (
              <><Send className="w-3.5 h-3.5" />Submit for Review</>
            )}
          </Button>
        )}
        {calStatus === "ready_for_review" && (
          <div
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--sketch-ink-faint)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Awaiting admin review
          </div>
        )}
        {calStatus === "approved" && (
          <div
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--sketch-ink-faint)",
            }}
          >
            Approved
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
