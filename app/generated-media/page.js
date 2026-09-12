import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getAccessibleBrandIds } from "@/lib/brand-access";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import {
  Images, ImageIcon, Video, Clock, AlertCircle, CheckCircle2, ExternalLink, Coins, CalendarDays,
} from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_CONFIG = {
  completed: { label: "Completed", icon: CheckCircle2, badge: "secondary", className: "text-green-500" },
  failed: { label: "Failed", icon: AlertCircle, badge: "destructive" },
  pending: { label: "Pending", icon: Clock, badge: "outline", className: "text-muted-foreground" },
};

export default async function GeneratedMediaPage() {
  const user = await getCurrentUser();
  const brandIds = await getAccessibleBrandIds(user);
  const mediaScope =
    brandIds === null
      ? {}
      : {
          OR: [
            { brandId: { in: brandIds } },
            { calendarPost: { calendar: { brandId: { in: brandIds } } } },
          ],
        };

  const media = await prisma.generatedMedia.findMany({
    where: mediaScope,
    include: {
      higgsfieldModel: true,
      brand: true,
      calendarPost: {
        include: { calendar: { select: { id: true, title: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Library"
        title="Generated Media"
        description="Images and videos generated via Higgsfield, including failed and pending attempts."
      />

      {media.length === 0 ? (
        <EmptyState icon={Images} title="No generated media yet." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((item) => {
            const status = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            const modelLabel = item.higgsfieldModel?.label || item.higgsfieldModel?.modelKey || "Unknown model";
            const mediaSrc = item.remoteUrl || item.filePath;

            return (
              <Card key={item.id} className="overflow-hidden">
                {mediaSrc && item.mediaType === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaSrc}
                    alt={item.sourcePrompt || "Generated image"}
                    className="w-full aspect-square object-cover"
                  />
                )}
                {mediaSrc && item.mediaType === "video" && (
                  <video
                    src={mediaSrc}
                    controls
                    className="w-full aspect-square object-cover bg-black"
                  />
                )}

                <CardHeader className="pb-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-xs capitalize">
                      {item.mediaType === "video" ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                      {item.mediaType}
                    </Badge>
                    <Badge variant={status.badge} className={cn("text-xs", status.className)}>
                      <StatusIcon className="w-3 h-3" />
                      {status.label}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs space-y-1 pt-1">
                    <div>{modelLabel}{item.brand?.name ? ` · ${item.brand.name}` : ""}</div>
                    <div className="flex items-center gap-3">
                      {typeof item.tokenCost === "number" && (
                        <span className="flex items-center gap-1">
                          <Coins className="w-3 h-3" />{item.tokenCost} tokens
                        </span>
                      )}
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0 space-y-2">
                  {item.calendarPost && (
                    <Link
                      href={`/content-calendar/${item.calendarPost.calendar.id}`}
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 border rounded-full px-2.5 py-1 hover:bg-muted transition-colors"
                    >
                      <CalendarDays className="w-3 h-3 shrink-0" />
                      {item.calendarPost.postNumber != null
                        ? `Post #${item.calendarPost.postNumber}`
                        : "Calendar post"}
                      {" — "}
                      {item.calendarPost.calendar.title}
                    </Link>
                  )}

                  {item.sourcePrompt && (
                    <p className="text-sm text-muted-foreground line-clamp-3">{item.sourcePrompt}</p>
                  )}

                  {item.status === "failed" && (
                    <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/30 rounded-lg px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{item.errorMessage || "Generation failed."}</span>
                    </div>
                  )}

                  {item.status === "pending" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span>Generation in progress…</span>
                    </div>
                  )}

                  {mediaSrc && (
                    <a
                      href={mediaSrc}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />Open full media
                    </a>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
