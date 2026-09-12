import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getAccessibleBrandIds } from "@/lib/brand-access";
import { StatBlock } from "@/components/content-report/StatBlock";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { ClassBadge } from "@/components/content-report/ClassBadge";
import { DraftStamp } from "@/components/content-report/DraftStamp";

export const dynamic = "force-dynamic";

export default async function ContentReportPage() {
  const user = await getCurrentUser();
  const brandIds = await getAccessibleBrandIds(user);
  const scope = brandIds === null ? {} : { brandId: { in: brandIds } };
  const mediaScope =
    brandIds === null
      ? {}
      : {
          OR: [
            { brandId: { in: brandIds } },
            { calendarPost: { calendar: { brandId: { in: brandIds } } } },
          ],
        };

  const [promptCount, mediaCount, templateCount] = await Promise.all([
    prisma.generatedPrompt.count({ where: scope }),
    prisma.generatedMedia.count({ where: mediaScope }),
    prisma.promptTemplate.count(),
  ]);

  const imageCount = await prisma.generatedMedia.count({
    where: { ...mediaScope, mediaType: "image" },
  });
  const videoCount = await prisma.generatedMedia.count({
    where: { ...mediaScope, mediaType: "video" },
  });

  const channels = [];
  if (imageCount > 0) channels.push("image");
  if (videoCount > 0) channels.push("video");
  if (promptCount > 0) channels.push("caption");
  if (channels.length === 0) channels.push("image", "video", "caption");

  const today = new Date().toISOString().split("T")[0];
  const reportNumber = String(
    Math.max(1, Math.floor((promptCount + mediaCount) / 50) + 1)
  ).padStart(2, "0");

  return (
    <>
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "#F2EEE4",
          backgroundImage:
            "radial-gradient(#CFC6B4 1px, transparent 1.4px)",
          backgroundSize: "22px 22px",
          padding: "56px 64px",
          boxSizing: "border-box",
          fontFamily: "'DM Mono', ui-monospace, monospace",
          color: "#1C1812",
          position: "relative",
        }}
      >
        {/* Registration tick — top-right */}
        <div
          style={{
            position: "absolute",
            top: "14px",
            right: "14px",
            width: "22px",
            height: "22px",
            borderTop: "1px solid #1C1812",
            borderRight: "1px solid #1C1812",
          }}
        />

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontFamily: "'Big Shoulders Display', sans-serif",
                fontWeight: 900,
                fontSize: "64px",
                lineHeight: 0.9,
                textTransform: "uppercase",
              }}
            >
              <span style={{ color: "#1C1812" }}>Campaign</span>
              <br />
              <span style={{ color: "#B23E26" }}>Report</span>
            </h1>
            <div
              style={{
                borderBottom: "2px solid #B23E26",
                width: "300px",
                marginTop: "8px",
              }}
            />
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#6B6052",
                marginTop: "8px",
              }}
            >
              Analysis Sheet &middot; Content Studio
            </div>
          </div>
          <div
            style={{
              fontFamily: "'Big Shoulders Display', sans-serif",
              fontWeight: 900,
              fontSize: "88px",
              lineHeight: 0.8,
              color: "#1C1812",
            }}
          >
            {reportNumber}
          </div>
        </div>

        {/* Two-column body */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "48px",
            marginTop: "48px",
            alignItems: "start",
          }}
        >
          {/* Left column */}
          <div>
            {/* Stat blocks */}
            <div
              style={{
                display: "flex",
                gap: "48px",
                marginBottom: "36px",
              }}
            >
              <StatBlock value={promptCount} label="Prompts" accent />
              <StatBlock value={mediaCount} label="Media" />
              <StatBlock value={templateCount} label="Templates" />
            </div>

            <SectionLabel meta="&middot; v0.8">Summary</SectionLabel>
            <p
              style={{
                fontFamily: "'IBM Plex Serif', Georgia, serif",
                fontSize: "15px",
                lineHeight: 1.6,
                color: "#3A332A",
                maxWidth: "42ch",
                margin: "14px 0 0",
              }}
            >
              This campaign cycle produced a coherent body of work across image,
              video, and caption territories. Output held to the brand&rsquo;s
              structural restraint &mdash; every decision made in advance, the
              grid invisible, the result inevitable.
            </p>

            <div style={{ marginTop: "30px" }}>
              <SectionLabel>Channels</SectionLabel>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginTop: "14px",
                  flexWrap: "wrap",
                }}
              >
                {channels.map((ch) => (
                  <ClassBadge key={ch} kind={ch} />
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div>
            {/* Metadata card */}
            <div
              style={{
                position: "relative",
                border: "1px solid #B49C78",
                background: "#F7F4EC",
                padding: "16px 18px",
                boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "#1C1812",
                  marginBottom: "10px",
                }}
              >
                Report Metadata
              </div>
              <MetadataRow label="Model" value="gpt-4o" />
              <MetadataRow label="Generated" value={today} />
              <MetadataRow
                label="Prompts"
                value={`${promptCount} total`}
              />
              <MetadataRow
                label="Status"
                value="Pending Review"
                accent
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "36px",
              }}
            >
              <DraftStamp primary="DRAFT" secondary="REVIEW" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "48px",
            fontSize: "10px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#6B6052",
            borderTop: "1px solid #CFC6B4",
            paddingTop: "14px",
          }}
        >
          <span>Content Studio &middot; Campaign Report</span>
          <span>Ink Cartography System</span>
        </div>
      </div>
    </>
  );
}

function MetadataRow({ label, value, accent = false }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 0",
        borderTop: "1px solid #E0D9CA",
      }}
    >
      <span
        style={{
          fontSize: "10px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#6B6052",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "11px",
          color: accent ? "#B23E26" : "#1C1812",
        }}
      >
        {value}
      </span>
    </div>
  );
}
