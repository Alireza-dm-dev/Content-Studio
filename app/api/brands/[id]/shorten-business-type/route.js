import { NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });
    }

    if (!brand.businessType?.trim()) {
      return NextResponse.json({ success: false, error: "Brand has no businessType to shorten." }, { status: 400 });
    }

    if (brand.businessType.length <= 60) {
      return NextResponse.json({ success: true, businessType: brand.businessType });
    }

    // Resolve API key: Settings table first, then env fallback — matches lib/ai.js pattern
    let apiKey = process.env.OPENAI_API_KEY;
    try {
      const setting = await prisma.settings.findUnique({ where: { key: "OPENAI_API_KEY" } });
      if (setting?.value && !setting.value.startsWith("your_")) {
        apiKey = setting.value;
      }
    } catch {
      // Settings lookup failed; fall back to env
    }
    if (!apiKey || apiKey.startsWith("your_")) {
      return NextResponse.json(
        { success: false, error: "OPENAI_API_KEY is not configured. Add it in Settings." },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 30,
      messages: [
        {
          role: "system",
          content:
            "You are a business-description editor. Your only job is to summarize a business type into a short, meaningful phrase. Output the phrase only — no quotes, no punctuation at the end, no explanation. The phrase must be 60 characters or fewer.",
        },
        {
          role: "user",
          content: brand.businessType,
        },
      ],
    });

    let shortened = completion.choices[0]?.message?.content ?? "";

    // Safety cleanup: trim, remove surrounding quotes
    shortened = shortened.trim().replace(/^["']|["']$/g, "");

    // Hard cap at 60 chars — prefer breaking at a word boundary
    if (shortened.length > 60) {
      const cut = shortened.slice(0, 60);
      const lastSpace = cut.lastIndexOf(" ");
      shortened = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
    }

    if (!shortened) {
      return NextResponse.json(
        { success: false, error: "AI returned an empty response. Please try again." },
        { status: 500 }
      );
    }

    await prisma.brand.update({
      where: { id },
      data: { businessType: shortened },
    });

    return NextResponse.json({ success: true, businessType: shortened });
  } catch (err) {
    console.error("[ShortenBusinessType] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to shorten business type. Please try again." },
      { status: 500 }
    );
  }
}
