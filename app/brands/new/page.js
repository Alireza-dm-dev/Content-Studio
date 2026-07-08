"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Upload, X, ImageIcon } from "lucide-react";
import Link from "next/link";

export default function NewBrandPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");

  const [form, setForm] = useState({
    name: "",
    website: "",
    instagramPage: "",
    linkedinPage: "",
    facebookPage: "",
    businessLocation: "",
    businessType: "",
    mainServicesOrProducts: "",
    targetAudience: "",
    brandTone: "",
    brandVisualStyle: "",
  });

  // Staged files: { file: File, preview: string }[]
  const [staged, setStaged] = useState([]);

  // Revoke object URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => staged.forEach((s) => URL.revokeObjectURL(s.preview));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleFileSelect(e) {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    const toAdd = selected
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({ file: f, preview: URL.createObjectURL(f) }));
    if (toAdd.length < selected.length) {
      toast.warning("Only image files are accepted.");
    }
    setStaged((prev) => [...prev, ...toAdd]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeStaged(index) {
    setStaged((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Brand name is required.");
    setLoading(true);
    try {
      // 1. Create brand
      setStatusText("Creating brand…");
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to create brand");
      const brand = await res.json();

      // 2. Upload staged images
      if (staged.length > 0) {
        let uploaded = 0;
        for (const { file } of staged) {
          setStatusText(`Uploading image ${uploaded + 1} of ${staged.length}…`);
          const fd = new FormData();
          fd.append("file", file);
          fd.append("purpose", "reference-image");
          const up = await fetch(`/api/brands/${brand.id}/files`, {
            method: "POST",
            body: fd,
          });
          if (up.ok) uploaded++;
          else {
            const err = await up.json();
            toast.error(`${file.name}: ${err.error ?? "Upload failed"}`);
          }
        }
        if (uploaded > 0) toast.success(`Brand created with ${uploaded} image${uploaded > 1 ? "s" : ""}.`);
        else toast.success("Brand created.");
      } else {
        toast.success("Brand created.");
      }

      router.push(`/brands/${brand.id}`);
      router.refresh();
    } catch {
      toast.error("Something went wrong.");
      setLoading(false);
      setStatusText("");
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/brands"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <h1 className="text-xl font-semibold">New Brand</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Business Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Business Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Brand Name *</Label>
              <Input id="name" name="name" value={form.name} onChange={handleChange} placeholder="e.g. Bloom Studio" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="businessType">Business Type</Label>
                <Input id="businessType" name="businessType" value={form.businessType} onChange={handleChange} placeholder="e.g. Creative Agency" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="businessLocation">Location</Label>
                <Input id="businessLocation" name="businessLocation" value={form.businessLocation} onChange={handleChange} placeholder="e.g. Austin, TX" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mainServicesOrProducts">Services / Products</Label>
              <Textarea id="mainServicesOrProducts" name="mainServicesOrProducts" value={form.mainServicesOrProducts} onChange={handleChange} placeholder="Describe the main services or products offered" rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="targetAudience">Target Audience</Label>
              <Textarea id="targetAudience" name="targetAudience" value={form.targetAudience} onChange={handleChange} placeholder="Who is the ideal customer?" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="brandTone">Brand Tone</Label>
                <Input id="brandTone" name="brandTone" value={form.brandTone} onChange={handleChange} placeholder="e.g. Warm and approachable" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brandVisualStyle">Visual Style</Label>
                <Input id="brandVisualStyle" name="brandVisualStyle" value={form.brandVisualStyle} onChange={handleChange} placeholder="e.g. Clean minimalism" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" value={form.website} onChange={handleChange} placeholder="https://..." />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="instagramPage">Instagram</Label>
                <Input id="instagramPage" name="instagramPage" value={form.instagramPage} onChange={handleChange} placeholder="@handle" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="linkedinPage">LinkedIn</Label>
                <Input id="linkedinPage" name="linkedinPage" value={form.linkedinPage} onChange={handleChange} placeholder="linkedin.com/..." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facebookPage">Facebook</Label>
                <Input id="facebookPage" name="facebookPage" value={form.facebookPage} onChange={handleChange} placeholder="facebook.com/..." />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Brand Images */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Brand Images</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Screenshots of website, social pages, ads, mood boards — anything that captures your brand visually.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              {staged.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />Add More
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {staged.length === 0 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center py-10 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <ImageIcon className="w-7 h-7 mb-2" />
                <span className="text-sm font-medium">Upload brand images</span>
                <span className="text-xs mt-1 text-center max-w-xs">
                  Website screenshots, social profiles, ads, logos, mood boards
                </span>
              </button>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {staged.map((s, i) => (
                  <div
                    key={i}
                    className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.preview}
                      alt={s.file.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeStaged(i)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-white text-xs truncate">{s.file.name}</p>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <Upload className="w-4 h-4 mb-0.5" />
                  <span className="text-xs">Add</span>
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          {loading && statusText ? (
            <span className="text-sm text-muted-foreground">{statusText}</span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" asChild disabled={loading}>
              <Link href="/brands">Cancel</Link>
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? statusText || "Creating…" : `Create Brand${staged.length > 0 ? ` & Upload ${staged.length} Image${staged.length > 1 ? "s" : ""}` : ""}`}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
