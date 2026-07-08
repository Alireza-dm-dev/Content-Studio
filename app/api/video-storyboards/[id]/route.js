import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/video-storyboards/[id]
export async function GET(request, { params }) {
  const { id } = await params;
  try {
    const storyboard = await prisma.videoStoryboard.findUnique({ where: { id } });
    if (!storyboard) {
      return NextResponse.json({ success: false, error: "Storyboard not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, videoStoryboard: storyboard });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: "Failed to load storyboard.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

// PATCH /api/video-storyboards/[id]
export async function PATCH(request, { params }) {
  const { id } = await params;
  console.log("[VideoStoryboard] PATCH id:", id);

  try {
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json({ success: false, error: "Invalid request body.", details: e.message }, { status: 400 });
    }

    const { approvedStoryboard, status, storyboardOutput } = body;

    const storyboard = await prisma.videoStoryboard.findUnique({ where: { id } });
    if (!storyboard) {
      return NextResponse.json({ success: false, error: "Storyboard not found." }, { status: 404 });
    }

    const updateData = {};
    if (approvedStoryboard !== undefined) updateData.approvedStoryboard = approvedStoryboard;
    if (status !== undefined)             updateData.status = status;
    if (storyboardOutput !== undefined)   updateData.storyboardOutput = storyboardOutput;

    const updated = await prisma.videoStoryboard.update({
      where: { id },
      data: updateData,
    });

    console.log("[VideoStoryboard] Updated id:", id, "status:", updated.status);

    return NextResponse.json({
      success: true,
      videoStoryboard: {
        id:                updated.id,
        brandId:           updated.brandId,
        calendarId:        updated.calendarId,
        calendarPostId:    updated.calendarPostId,
        storyboardOutput:  updated.storyboardOutput,
        approvedStoryboard: updated.approvedStoryboard,
        status:            updated.status,
        createdAt:         updated.createdAt,
        updatedAt:         updated.updatedAt,
      },
    });

  } catch (err) {
    console.error("[VideoStoryboard] PATCH error:", err);
    return NextResponse.json({
      success: false,
      error: "Failed to update storyboard. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
