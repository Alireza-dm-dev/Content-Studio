"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

const platforms = ["Instagram", "TikTok", "YouTube", "Twitter/X", "LinkedIn", "Facebook", "Pinterest"];

export default function NewCalendarPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ title: "", platform: "", startDate: "", endDate: "" });

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Title is required.");
    setLoading(true);
    try {
      const res = await fetch("/api/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Calendar created!");
      router.push("/content-calendar");
      router.refresh();
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/content-calendar"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <h1 className="text-xl font-semibold">New Content Calendar</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendar Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title *</Label>
              <Input id="title" name="title" value={form.title} onChange={handleChange} placeholder="e.g. Q3 Instagram Campaign" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="platform">Platform</Label>
              <select
                id="platform"
                name="platform"
                value={form.platform}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select platform</option>
                {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">Start Date</Label>
                <Input type="date" id="startDate" name="startDate" value={form.startDate} onChange={handleChange} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate">End Date</Label>
                <Input type="date" id="endDate" name="endDate" value={form.endDate} onChange={handleChange} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/content-calendar">Cancel</Link>
              </Button>
              <Button type="submit" disabled={loading}>{loading ? "Creating..." : "Create Calendar"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
