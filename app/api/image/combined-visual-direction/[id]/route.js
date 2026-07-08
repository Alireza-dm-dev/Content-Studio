import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(request, { params }) {
  const { id } = await params;
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

    const saved = await prisma.combinedVisualDirection.update({
      where: { id },
      data,
    });

    const parseCombinedJson = (s) => { try { return JSON.parse(s ?? "{}"); } catch { return {}; } };

    return NextResponse.json({
      success: true,
      combinedVisualDirection: {
        id:               saved.id,
        brandId:          saved.brandId,
        status:           saved.status,
        combinedJson:     parseCombinedJson(saved.jsonOutput),
        editedJson:       saved.editedJson ? parseCombinedJson(saved.editedJson) : null,
        finalNanobananaPrompt: saved.finalNanobananaPrompt,
        updatedAt:        saved.updatedAt,
      },
    });
  } catch (err) {
    console.error("[CombinedVisualDir PATCH] Error:", err);
    return NextResponse.json({
      success: false,
      error: "Failed to update combined visual direction.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
