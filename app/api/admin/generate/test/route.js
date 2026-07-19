import { NextResponse } from "next/server";
import { generateWithPromptTemplate } from "@/lib/ai";
import { getAdminAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const { templateSlug, variables, responseFormat, images, userInput } = body;

  if (typeof templateSlug !== "string" || !templateSlug.trim()) {
    return NextResponse.json(
      { success: false, error: "templateSlug is required" },
      { status: 400 }
    );
  }

  const template = await prisma.promptTemplate.findUnique({
    where: { slug: templateSlug },
    select: { id: true, slug: true },
  });

  if (!template) {
    return NextResponse.json(
      { success: false, error: "Prompt template not found" },
      { status: 404 }
    );
  }

  try {
    const result = await generateWithPromptTemplate({
      templateSlug,
      variables: variables ?? {},
      responseFormat: responseFormat ?? "auto",
      images: images ?? [],
      userInput: userInput ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err.message ?? "Generation failed" },
      { status: 500 }
    );
  }
}
