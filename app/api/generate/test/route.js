import { NextResponse } from "next/server";
import { generateWithPromptTemplate } from "@/lib/ai";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { templateSlug, variables, responseFormat, images, userInput } = body;

  if (!templateSlug) {
    return NextResponse.json({ error: "templateSlug is required" }, { status: 400 });
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
