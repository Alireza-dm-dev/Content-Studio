import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Sparkles, Briefcase, ImageIcon } from "lucide-react";

const options = [
  {
    href: "/create-image/raw-idea",
    icon: Sparkles,
    title: "Boost a Raw Idea",
    description: "Describe your image idea in plain words — AI will expand it into a detailed, optimised prompt.",
  },
  {
    href: "/create-image/from-brand",
    icon: Briefcase,
    title: "Create image based on brand",
    description: "Pick a brand, review its visual identity, and generate a branded image prompt.",
  },
  {
    href: "/create-image/reference-flow",
    icon: ImageIcon,
    title: "Create image based on reference image",
    description: "Upload a reference image and direct the AI what to keep and what to change — guided, brand-aware.",
  },
];

export default function CreateImagePage() {
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        eyebrow="Image prompts"
        title="Create Image"
        description="Choose how you want to create your image prompt."
        backHref="/"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {options.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full transition-colors hover:border-foreground hover:bg-muted/40 cursor-pointer">
              <CardHeader className="gap-3">
                <div className="sketch-frame icon-sketch flex size-11 items-center justify-center bg-card text-foreground">
                  <Icon className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>
                  <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
