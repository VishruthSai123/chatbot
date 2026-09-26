import { auth } from "@/app/(auth)/auth";
import {
  getOrCreateBrowserSession,
  stopBrowserSession,
} from "@/lib/browser-use/session";
import { getTestSessionByChatId } from "@/lib/db/queries";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return Response.json(
      { error: "chatId parameter is required" },
      { status: 400 }
    );
  }

  try {
    const testSession = await getTestSessionByChatId({ chatId });

    if (!testSession) {
      return Response.json({ session: null });
    }

    return Response.json({
      session: {
        browserSessionId: testSession.browserSessionId,
        chatId: testSession.chatId,
        id: testSession.id,
        liveUrl: testSession.liveUrl,
        status: testSession.status,
        targetUrl: testSession.targetUrl,
      },
    });
  } catch (error) {
    console.error("[QA Session API] GET error:", error);
    return Response.json(
      { error: "Failed to fetch test session" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { chatId, targetUrl, projectId } = body;

    if (!chatId || !targetUrl) {
      return Response.json(
        { error: "chatId and targetUrl are required" },
        { status: 400 }
      );
    }

    const browserSession = await getOrCreateBrowserSession({
      chatId,
      projectId,
      targetUrl,
    });

    return Response.json({ session: browserSession });
  } catch (error) {
    console.error("[QA Session API] POST error:", error);
    return Response.json(
      { error: "Failed to create/retrieve browser session" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return Response.json(
      { error: "chatId parameter is required" },
      { status: 400 }
    );
  }

  try {
    const result = await stopBrowserSession({ chatId });
    return Response.json(result);
  } catch (error) {
    console.error("[QA Session API] DELETE error:", error);
    return Response.json(
      { error: "Failed to stop browser session" },
      { status: 500 }
    );
  }
}
