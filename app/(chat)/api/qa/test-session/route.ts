import { getBrowserUseClient } from "@/lib/browser-use/client";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetUrl = (body.targetUrl || "https://example.com").trim();
    const width = Math.min(Math.max(Number(body.width) || 1442, 360), 3840);
    const height = Math.min(Math.max(Number(body.height) || 1002, 360), 2160);

    const client = getBrowserUseClient();

    console.log(
      `[BrowserUse Simulator] Spawning test session for ${targetUrl} (${width}x${height})...`
    );

    const session = await client.sessions.create({
      browserScreenHeight: height,
      browserScreenWidth: width,
      enableRecording: true,
      keepAlive: true,
      persistMemory: false,
      startUrl: targetUrl,
    });

    return Response.json({
      height,
      liveUrl: session.liveUrl ?? null,
      sessionId: session.id,
      targetUrl,
      width,
    });
  } catch (error) {
    console.error("[BrowserUse Simulator] Error creating test session:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create session";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (sessionId) {
      const client = getBrowserUseClient();
      console.log(
        `[BrowserUse Simulator] Stopping test session ${sessionId}...`
      );
      await client.sessions.stop(sessionId).catch((err) => {
        console.warn("[BrowserUse Simulator] Error stopping session:", err);
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to stop session";
    return Response.json({ error: message }, { status: 500 });
  }
}
