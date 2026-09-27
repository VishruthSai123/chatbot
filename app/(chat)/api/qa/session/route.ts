import { auth } from "@/app/(auth)/auth";
import { getBrowserUseClient } from "@/lib/browser-use/client";
import {
  getOrCreateBrowserSession,
  stopBrowserSession,
} from "@/lib/browser-use/session";
import {
  getQAFindingsBySessionId,
  getTestSessionByChatId,
  updateTestSessionStatus,
} from "@/lib/db/queries";
import { ExecutionTracker } from "@/lib/qa/execution-tracker";

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
      return Response.json({ execution: null, session: null });
    }

    const { status: initialStatus, liveUrl: initialLiveUrl } = testSession;
    let currentStatus = initialStatus;
    let liveUrl = initialLiveUrl;

    let cloudScreenWidth: number | undefined;
    let cloudScreenHeight: number | undefined;
    if (testSession.browserSessionId && testSession.status === "active") {
      try {
        const client = getBrowserUseClient();
        const cloudSession = await client.sessions.get(
          testSession.browserSessionId
        );
        if (cloudSession && cloudSession.status !== "active") {
          currentStatus = "completed";
          await updateTestSessionStatus({
            id: testSession.id,
            status: "completed",
          });
        } else if (cloudSession) {
          cloudScreenWidth =
            (cloudSession as any).browserScreenWidth ?? undefined;
          cloudScreenHeight =
            (cloudSession as any).browserScreenHeight ?? undefined;
          if (cloudSession.liveUrl && cloudSession.liveUrl !== liveUrl) {
            const { liveUrl: cloudLiveUrl } = cloudSession;
            liveUrl = cloudLiveUrl;
            await updateTestSessionStatus({
              id: testSession.id,
              liveUrl,
              status: "active",
            });
          }
        }
      } catch {
        currentStatus = "completed";
        await updateTestSessionStatus({
          id: testSession.id,
          status: "completed",
        }).catch(() => null);
      }
    }

    // Retrieve active or last execution from tracker
    let execution = ExecutionTracker.getActiveRun(chatId);

    // If tracker in-memory is empty (e.g. server reboot or new tab), restore from DB snapshot
    if (!execution && testSession) {
      if (testSession.executionSnapshot) {
        try {
          execution = ExecutionTracker.restoreRun(
            testSession.executionSnapshot as any
          );
        } catch (err) {
          console.warn(
            "[QA Session API] Failed to restore execution snapshot:",
            err
          );
        }
      }

      // Fallback reconstruction if no snapshot was persisted yet
      if (!execution) {
        const findings = await getQAFindingsBySessionId({
          testSessionId: testSession.id,
        }).catch(() => []);

        const lastFinding = findings.at(-1);
        const isComplete =
          currentStatus === "completed" || Boolean(lastFinding);
        const isStopped =
          currentStatus === "cancelled" || currentStatus === "paused";

        execution = {
          activeTaskId: null,
          browserSessionId: testSession.browserSessionId ?? undefined,
          chatId: testSession.chatId,
          completedAt:
            isComplete || isStopped
              ? testSession.updatedAt.toISOString()
              : undefined,
          currentAction: isComplete
            ? "Test completed"
            : isStopped
              ? "Test stopped by user"
              : "Ready",
          currentStep: 0,
          executionState: isComplete
            ? "COMPLETED"
            : isStopped
              ? "CANCELLED"
              : currentStatus === "active"
                ? "WAITING"
                : "STARTING",
          findingId: lastFinding?.id,
          lastActivityAt: testSession.updatedAt.toISOString(),
          runId: `restored-${testSession.id}`,
          sequence: 1,
          sessionId: testSession.id,
          startedAt: testSession.createdAt.toISOString(),
          steps: [],
          targetUrl: testSession.targetUrl,
          verdict: (lastFinding?.verdict as any) ?? undefined,
        };
      }
    }

    return Response.json({
      execution,
      session: {
        browserScreenHeight: cloudScreenHeight,
        browserScreenWidth: cloudScreenWidth,
        browserSessionId: testSession.browserSessionId,
        chatId: testSession.chatId,
        id: testSession.id,
        liveUrl,
        status: currentStatus,
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
    const {
      chatId,
      targetUrl,
      projectId,
      browserScreenWidth,
      browserScreenHeight,
      action,
      reason,
    } = body;

    if (!chatId) {
      return Response.json({ error: "chatId is required" }, { status: 400 });
    }

    // Handle explicit resume action
    if (action === "resume") {
      const resumedRun = await ExecutionTracker.resumeRun({ chatId });
      const testSession = await getTestSessionByChatId({ chatId });
      return Response.json({
        execution: resumedRun,
        session: testSession,
        success: true,
      });
    }

    // Handle explicit stop action without deleting session
    if (action === "stop") {
      const cancelledRun = await ExecutionTracker.cancelRun({
        chatId,
        reason: reason || "user_stopped",
      });
      const testSession = await getTestSessionByChatId({ chatId });
      return Response.json({
        execution: cancelledRun,
        session: testSession,
        success: true,
      });
    }

    if (!targetUrl) {
      return Response.json(
        { error: "targetUrl is required to create or get browser session" },
        { status: 400 }
      );
    }

    const browserSession = await getOrCreateBrowserSession({
      browserScreenHeight,
      browserScreenWidth,
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
  const terminateCloud = searchParams.get("terminate") === "true";

  if (!chatId) {
    return Response.json(
      { error: "chatId parameter is required" },
      { status: 400 }
    );
  }

  try {
    const cancelledRun = await ExecutionTracker.cancelRun({
      chatId,
      reason: "user_stopped",
    });

    // Safely stop browser session (only destroy cloud instance if terminate=true requested)
    const result = await stopBrowserSession({
      chatId,
      terminateCloudSession: terminateCloud,
    });

    return Response.json({
      ...result,
      execution: cancelledRun,
    });
  } catch (error) {
    console.error("[QA Session API] DELETE error:", error);
    return Response.json(
      { error: "Failed to stop browser session" },
      { status: 500 }
    );
  }
}
