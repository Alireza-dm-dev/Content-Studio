"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import StepCalendarForm from "@/app/content-calendar/create/StepCalendarForm";
import StepCalendarOutput from "@/app/content-calendar/create/StepCalendarOutput";

export function PortalCreateCalendarClient({ brand, brandIdentity }) {
  const [step, setStep] = useState(1);
  const [selectedPostIdeas] = useState([]);
  const [calendarPosts, setCalendarPosts] = useState([]);
  const [calendarRaw, setCalendarRaw] = useState("");
  const [calendarFormData, setCalendarFormData] = useState(null);
  const [calendarMeta, setCalendarMeta] = useState({ model: "", usage: "" });
  const [referenceAttachments, setReferenceAttachments] = useState([]);

  const defaultForm = {
    platforms: "",
    requiredPostFormats: "",
    monthlySubject: "",
    targetAudience: "",
    mainGoal: "",
    mainOfferOrMessage: "",
    sourceMaterial: "",
    calendarPeriod: "",
    calendarPeriodStart: "",
    calendarPeriodEnd: "",
  };

  const [calendarForm, setCalendarForm] = useState(defaultForm);

  return (
    <div>
      <Link
        href={`/calendar-portal/brands/${brand.id}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontFamily: "var(--font-mono-ink)",
          fontSize: 10,
          letterSpacing: "0.08em",
          color: "var(--sketch-ink-faint)",
          textDecoration: "none",
          marginBottom: 16,
        }}
      >
        <ArrowLeft className="w-3 h-3" />
        Back to {brand.name} calendars
      </Link>

      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: 32,
          lineHeight: 1,
          color: "var(--sketch-ink)",
          margin: "0 0 20px",
        }}
      >
        New Calendar
      </h1>

      {step === 1 && (
        <StepCalendarForm
          brand={brand}
          brandIdentity={brandIdentity}
          selectedPosts={selectedPostIdeas}
          prefillCampaignEvents={[]}
          prefillMainGoal=""
          prefillMainOfferOrMessage=""
          calendarPeriod=""
          calendarPeriodStart=""
          calendarPeriodEnd=""
          chosenSeasonalDates={[]}
          form={calendarForm}
          setForm={setCalendarForm}
          onBack={() => {}}
          brandId={brand.id}
          referenceAttachments={referenceAttachments}
          onReferenceAttachmentsChange={setReferenceAttachments}
          onGenerated={({ posts, raw, formData, model, usage }) => {
            setCalendarPosts(posts || []);
            setCalendarRaw(raw || "");
            setCalendarFormData(formData || null);
            setCalendarMeta({ model, usage });
            setStep(2);
          }}
        />
      )}

      {step === 2 && calendarFormData && (
        <StepCalendarOutput
          brand={brand}
          formData={calendarFormData}
          initialPosts={calendarPosts}
          rawOutput={calendarRaw}
          model={calendarMeta?.model}
          usage={calendarMeta?.usage}
          onBack={() => setStep(1)}
          referenceAttachments={referenceAttachments}
        />
      )}
    </div>
  );
}
