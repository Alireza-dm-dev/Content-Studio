"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import { Eye, EyeOff, Save, HardDriveUpload, AlertCircle, Coins } from "lucide-react";
import AiTestCard from "./AiTestCard";

function ApiKeyCard() {
  const [showKey, setShowKey] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveSettings(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "OPENAI_API_KEY", value: openaiKey }),
      });
      if (!res.ok) throw new Error();
      toast.success("API key saved.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Configuration</CardTitle>
        <CardDescription className="text-xs">
          Set your OpenAI API key to enable all AI generation features.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={saveSettings} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="openaiKey">OpenAI API Key</Label>
            <div className="relative">
              <Input
                id="openaiKey"
                type={showKey ? "text" : "password"}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored locally in SQLite. Also set <code className="font-mono">OPENAI_API_KEY</code> in{" "}
              <code className="font-mono">.env</code> for server-side calls.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function HiggsfieldApiKeyCard() {
  const [showKey, setShowKey] = useState(false);
  const [higgsfieldKey, setHiggsfieldKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveSettings(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "HIGGSFIELD_API_KEY", value: higgsfieldKey }),
      });
      if (!res.ok) throw new Error();
      toast.success("API key saved.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Higgsfield API Key</CardTitle>
        <CardDescription className="text-xs">
          Used later for Higgsfield image and video generation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={saveSettings} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="higgsfieldKey">Higgsfield API Key</Label>
            <div className="relative">
              <Input
                id="higgsfieldKey"
                type={showKey ? "text" : "password"}
                value={higgsfieldKey}
                onChange={(e) => setHiggsfieldKey(e.target.value)}
                placeholder="hf-..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored locally in SQLite as <code className="font-mono">HIGGSFIELD_API_KEY</code>.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function HiggsfieldTokenManagementCard() {
  const [balance, setBalance] = useState(null);
  const [recentLedger, setRecentLedger] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  function loadBalance() {
    return fetch("/api/higgsfield/balance")
      .then((r) => r.json())
      .then((data) => {
        setBalance(data.balance);
        setRecentLedger(data.recentLedger ?? []);
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadBalance().finally(() => setLoading(false));
    fetch("/api/higgsfield/models")
      .then((r) => r.json())
      .then((data) => setModels(data.models ?? []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const parsedDelta = Number(delta);
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      setFormError("Delta must be a non-zero integer.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/higgsfield/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: parsedDelta, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Adjustment failed.");
      setDelta("");
      setReason("");
      await loadBalance();
      toast.success("Balance updated.");
    } catch (err) {
      setFormError(err.message);
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Coins className="w-4 h-4" />Higgsfield Token Balance
        </CardTitle>
        <CardDescription className="text-xs">
          Track and manually adjust the local Higgsfield token balance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Current balance */}
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-3">
          <span className="text-sm text-muted-foreground">Current balance</span>
          {loading ? (
            <span className="text-sm text-muted-foreground">Loading…</span>
          ) : (
            <Badge variant="secondary" className="text-base font-mono px-3 py-1">
              {balance?.balance ?? 0} tokens
            </Badge>
          )}
        </div>

        {/* Manual adjustment form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="hfDelta">Delta (+/-)</Label>
              <Input
                id="hfDelta"
                type="number"
                step="1"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="e.g. 100 or -25"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hfReason">Reason (optional)</Label>
              <Input
                id="hfReason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="manual_adjustment"
              />
            </div>
          </div>
          {formError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{formError}</p>
            </div>
          )}
          <Button type="submit" size="sm" disabled={submitting} className="gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {submitting ? "Applying…" : "Apply Adjustment"}
          </Button>
        </form>

        <Separator />

        {/* Recent ledger entries */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Recent Ledger Entries</Label>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : recentLedger.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
          ) : (
            <div className="space-y-1">
              {recentLedger.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between py-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={entry.delta > 0 ? "secondary" : "outline"} className="font-mono">
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </Badge>
                    <span className="text-muted-foreground">{entry.reason}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <span>balance: {entry.balanceAfter}</span>
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Read-only model list */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Higgsfield Models</Label>
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">No models configured.</p>
          ) : (
            <div className="space-y-1">
              {models.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{model.label}</span>
                      <Badge variant="outline" className="text-xs capitalize">{model.mediaType}</Badge>
                      <Badge variant={model.isActive ? "secondary" : "outline"} className="text-xs">
                        {model.isActive ? "active" : "inactive"}
                      </Badge>
                    </div>
                    {model.description && (
                      <p className="text-xs text-muted-foreground">{model.description}</p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs font-mono shrink-0">
                    {model.tokenCost} tokens
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Configure your content studio."
      />
      <div className="space-y-6">
        <ApiKeyCard />
        <HiggsfieldApiKeyCard />
        <HiggsfieldTokenManagementCard />
        <AiTestCard />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User Management</CardTitle>
            <CardDescription className="text-xs">
              Create and manage user accounts and brand access for the Calendar Portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm" variant="outline">
              <a href="/settings/users">Manage Users</a>
            </Button>
          </CardContent>
        </Card>
        <Separator />
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <HardDriveUpload className="w-4 h-4" />Google Drive Export
            </CardTitle>
            <CardDescription className="text-xs">
              Connect Google Drive to upload exported content calendars directly from the app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-3">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-400">Not connected</p>
                <p className="text-xs text-muted-foreground">
                  To enable Google Drive export, add these environment variables to your{" "}
                  <code className="font-mono">.env</code> file and implement the OAuth callback:
                </p>
                <ul className="text-xs text-muted-foreground font-mono space-y-0.5 mt-1">
                  <li>GOOGLE_CLIENT_ID</li>
                  <li>GOOGLE_CLIENT_SECRET</li>
                  <li>GOOGLE_REDIRECT_URI</li>
                </ul>
                <p className="text-xs text-muted-foreground mt-1">
                  Once authorized, store the access token as{" "}
                  <code className="font-mono">GOOGLE_ACCESS_TOKEN</code> in the Settings table.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Storage</CardTitle>
            <CardDescription className="text-xs">Local file storage locations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">Brand uploads</span>
              <Badge variant="outline" className="text-xs font-mono">public/uploads/[brandId]/[purpose]/</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Version",   value: "MVP v0.1",           variant: "secondary" },
              { label: "Database",  value: "SQLite",             variant: "outline" },
              { label: "Framework", value: "Next.js App Router", variant: "outline" },
              { label: "AI",        value: "OpenAI gpt-4o",      variant: "outline" },
            ].map(({ label, value, variant }) => (
              <div key={label} className="flex items-center justify-between py-1">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Badge variant={variant}>{value}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
