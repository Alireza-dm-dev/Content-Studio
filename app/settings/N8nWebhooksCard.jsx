"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Trash2, AlertCircle } from "lucide-react";

// Admin-only. Production webhooks: status only (never the URL, not editable).
// Trial webhook: configure / replace / clear; secret is write-only.

const SOURCE_LABEL = {
  settings: "Configured via Settings",
  environment: "Configured via environment",
  none: "Not configured",
};

function StatusRow({ label, status }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <span className="text-sm">{label}</span>
      <Badge variant={status === "none" ? "outline" : "secondary"}>{SOURCE_LABEL[status] || "Unknown"}</Badge>
    </div>
  );
}

export default function N8nWebhooksCard() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [url, setUrl] = useState("");
  const [authMode, setAuthMode] = useState("none");
  const [headerName, setHeaderName] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function apply(s) {
    setState(s);
    setAuthMode(s.trial.authMode);
    setHeaderName(s.trial.headerName || "");
    setUrl("");
    setSecret("");
  }

  useEffect(() => {
    fetch("/api/settings/n8n", { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!r.ok || !b) throw new Error(b?.error || "Could not load n8n settings.");
        apply(b);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  async function save(body, okMessage) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/settings/n8n", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b) throw new Error(b?.error || "Could not save the trial webhook settings.");
      apply(b);
      toast.success(okMessage);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    const body = { authMode, headerName };
    if (url.trim()) body.url = url.trim();
    if (secret) body.secret = secret;
    save(body, "Trial webhook settings saved.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">n8n Webhooks</CardTitle>
        <CardDescription className="text-xs">
          Production webhooks are shown as status only. The trial webhook receives Trial Send requests from post
          detail modals and is never used as a production fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        {state && (
          <>
            <div className="space-y-2" aria-label="Production webhook status">
              <StatusRow label="Production Publish Webhook" status={state.production.publish} />
              <StatusRow label="Production Delete Webhook" status={state.production.delete} />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm">Trial Webhook</span>
                <Badge variant={state.trial.configured ? "secondary" : "outline"} data-testid="trial-status">
                  {state.trial.configured ? `Configured · ${state.trial.maskedUrl}` : "Not configured"}
                </Badge>
              </div>
              {state.trial.configured && (
                <p className="text-xs text-muted-foreground">
                  {state.trial.destinationType} · Authentication:{" "}
                  {state.trial.authMode === "header"
                    ? `Header (${state.trial.headerName}${state.trial.secretConfigured ? ", secret set" : ", no secret"})`
                    : "None"}
                </p>
              )}
            </div>

            <div className="flex gap-2 rounded-md border border-dashed p-3 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{state.trial.warning}</span>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="trialUrl">Trial Webhook URL</Label>
                <Input
                  id="trialUrl"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={state.trial.configured ? "Leave empty to keep the current URL" : "https://your-n8n-host/webhook-test/…"}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  HTTPS only. Must be on an approved n8n host and must differ from the production publish and delete
                  webhooks. Changing the host requires re-entering the header secret. See docs/N8N_TRIAL_SEND.md.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="trialAuth">Authentication</Label>
                <select
                  id="trialAuth"
                  value={authMode}
                  onChange={(e) => setAuthMode(e.target.value)}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="none">None</option>
                  <option value="header">Header Authentication</option>
                </select>
              </div>

              {authMode === "header" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="trialHeaderName">Header name</Label>
                    <Input id="trialHeaderName" value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-N8N-Trial-Key" autoComplete="off" spellCheck={false} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="trialSecret">Header secret</Label>
                    <Input
                      id="trialSecret"
                      type="password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder={state.trial.secretConfigured ? "Secret is set — leave empty to keep it" : "Enter the secret"}
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-muted-foreground">
                      Write-only: it is never shown again. Stored in the Settings table as plain text (not encrypted).
                    </p>
                  </div>
                </>
              )}

              {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

              <div className="flex gap-2 flex-wrap">
                <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                  <Save className="w-3.5 h-3.5" />
                  {saving ? "Saving…" : "Save trial settings"}
                </Button>
                {state.trial.secretConfigured && (
                  <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => save({ clearSecret: true, authMode: "none" }, "Trial header secret removed.")}>
                    Remove secret
                  </Button>
                )}
                {state.trial.configured && (
                  <Button type="button" size="sm" variant="outline" disabled={saving} className="gap-1.5" onClick={() => save({ url: "" }, "Trial webhook cleared.")}>
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear trial webhook
                  </Button>
                )}
              </div>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
