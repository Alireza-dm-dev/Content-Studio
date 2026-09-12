import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request, { params }) {

  // Prompt templates are global configuration, not brand content.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (currentUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { id } = await params;
  const template = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(template);
}

export async function PATCH(request, { params }) {

  // Prompt templates are global configuration, not brand content.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (currentUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
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

  // Prompt templates are global configuration, not brand content.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (currentUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const template = await prisma.promptTemplate.update({
    where: { id },
    data: { templateText: existing.defaultTemplateText },
  });
  return NextResponse.json(template);
}
