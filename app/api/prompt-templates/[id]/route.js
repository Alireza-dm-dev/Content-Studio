import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request, { params }) {
  const { id } = await params;
  const template = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(template);
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const { templateText } = await request.json();
  if (typeof templateText !== "string") {
    return NextResponse.json({ error: "templateText is required" }, { status: 400 });
  }
  const template = await prisma.promptTemplate.update({
    where: { id },
    data: { templateText },
  });
  return NextResponse.json(template);
}

// Restore templateText to defaultTemplateText
export async function DELETE(request, { params }) {
  const { id } = await params;
  const existing = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const template = await prisma.promptTemplate.update({
    where: { id },
    data: { templateText: existing.defaultTemplateText },
  });
  return NextResponse.json(template);
}
