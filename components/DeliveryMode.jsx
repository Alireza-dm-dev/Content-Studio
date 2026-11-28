"use client";

import { toast } from "sonner";
import {
  deliveryModeLabel,
  isNonProductionDeliveryMode,
  PROMOTION_WARNING,
  PRODUCTION_DELIVERY_SKIPPED_CODE,
} from "@/lib/publishing-mode";

// Delivery-mode UI shared by the post cards, detail modals and Today (V1.3.56).
// Delivery mode is NOT publishing status: a Trial post can be a Draft, and a
// successful trial is never shown as Published. Legacy posts (null) show no
// badge, so nothing implies that production delivery was confirmed.

const mono = { fontFamily: "var(--font-mono-ink)", fontSize: 9, letterSpacing: "0.08em", lineHeight: 1.4 };
const TONE = {
  production: { border: "var(--sketch-ink)", color: "var(--sketch-ink)", background: "var(--sketch-paper-bright)" },
  trial: { border: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)", background: "var(--sketch-paper-bright)" },
  save_only: { border: "var(--sketch-line)", color: "var(--sketch-ink-soft)", background: "var(--sketch-paper-bright)" },
};
const TITLE = {
  production: "Delivery mode: Production. Edits are sent to the production n8n webhook.",
  trial: "Delivery mode: Trial. Never sent to production automatically; use Send to n8n to send it to production.",
  save_only: "Delivery mode: Save Only. Never sent to production automatically; use Send to n8n to send it to production.",
};

export function DeliveryModeBadge({ mode, style, withPrefix = false }) {
  const label = deliveryModeLabel(mode);
  if (!label) return null;
  const t = TONE[mode];
  return (
    <span
      data-testid="delivery-mode-badge"
      data-delivery-mode={mode}
      title={TITLE[mode]}
      style={{ ...mono, textTransform: "uppercase", padding: "1px 5px", border: `1px solid ${t.border}`, color: t.color, background: t.background, whiteSpace: "nowrap", display: "inline-block", ...style }}
    >
      {withPrefix ? `Delivery: ${label}` : label}
    </span>
  );
}

/** Inline confirmation shown before a manual production send of a Trial / Save Only post. */
export function PromotionConfirm({ onCancel, onConfirm }) {
  return (
    <div role="alertdialog" aria-label="Confirm production send" data-testid="promotion-confirm" style={{ border: "1px dashed var(--sketch-vermilion)", padding: "8px 10px", marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ ...mono, fontSize: 10, color: "var(--sketch-ink)" }}>{PROMOTION_WARNING}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={onCancel} style={btn}>Cancel</button>
        <button type="button" onClick={onConfirm} style={{ ...btn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" }}>Send to Production</button>
      </div>
    </div>
  );
}
const btn = { ...mono, fontSize: 10, textTransform: "uppercase", padding: "4px 10px", border: "1px solid var(--sketch-ink)", background: "transparent", color: "var(--sketch-ink-soft)", cursor: "pointer" };

export const needsPromotionConfirm = (post) => isNonProductionDeliveryMode(post?.deliveryMode);

/** Extra messages for a manual send response that carried a promotion block. */
export function reportPromotion(data) {
  const p = data?.promotion;
  if (!p) return;
  if (p.promoted) toast.success("Post is now in Production mode: future edits are sent to production.");
  else if (p.partialFailure) toast.error(p.error);
  else if (p.deliveryUncertain) toast.warning(p.error);
}

/** Edit response for a Trial / Save Only post: say that production was skipped. */
export function reportEditDelivery(data) {
  if (data?.webhookResult?.code === PRODUCTION_DELIVERY_SKIPPED_CODE) {
    toast.info(data.webhookResult.message);
  }
}
