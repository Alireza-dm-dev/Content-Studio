import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";

export async function PATCH(request, { params }) {
  const { id } = await params;

  // Indirect id: resolve the record's owning brand, then authorize. This is
  // what stops a user reaching another brand's data by guessing an id.
  const access = await requireResourceBrandAccess("referenceImageAnalysis", id);
  if (!access.ok) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }

  try {
    const body = await request.json();
    const { editedJson, status } = body;

    const data = {};
    if (editedJson !== undefined) {
      data.editedJson = typeof editedJson === "string"
        ? editedJson
        : JSON.stringify(editedJson);
    }
    if (status) data.status = status;

    const analysis = await prisma.referenceImageAnalysis.update({
      where: { id },
      data,
      include: {
        uploadedFile: { select: { filePath: true, fileName: true } },
      },
    });

    const parsedJsonOutput = (() => {
      try { return JSON.parse(analysis.jsonOutput ?? "{}"); } catch { return {}; }
    })();
    const parsedEditedJson = (() => {
      if (!analysis.editedJson) return null;
      try { return JSON.parse(analysis.editedJson); } catch { return null; }
    })();

    return NextResponse.json({
      success: true,
      referenceImageAnalysis: {
        id:           analysis.id,
        brandId:      analysis.brandId,
        calendarId:   analysis.calendarId,
        calendarPostId: analysis.calendarPostId,
        sourceFlow:   analysis.sourceFlow,
        imageUrl:     analysis.uploadedFile?.filePath ?? null,
        analysisJson: parsedJsonOutput,
        editedJson:   parsedEditedJson,
        status:       analysis.status,
        createdAt:    analysis.createdAt,
        updatedAt:    analysis.updatedAt,
      },
    });

  } catch (err) {
    console.error("[RefImagePatch] Error:", err);
    return NextResponse.json({
      success: false,
      error: "Failed to update analysis.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
