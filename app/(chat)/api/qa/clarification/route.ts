import { auth } from "@/app/(auth)/auth";
import { ExecutionTracker } from "@/lib/qa/execution-tracker";

/**
 * POST /api/qa/clarification
 *
 * Receives the user's answer or cancellation for a pending clarification question.
 * Atomically validates ownership, run state, and question ID, then updates the
 * execution tracker to unblock the tool loop or resume the execution.
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { chatId, questionId, answer, action } = body;

    if (
      !chatId ||
      !questionId ||
      (answer === undefined && action === undefined)
    ) {
      return Response.json(
        {
          error: "chatId, questionId, and answer or action are required",
        },
        { status: 400 }
      );
    }

    const { getChatById } = await import("@/lib/db/queries");
    const chat = await getChatById({ id: chatId });
    if (!chat || chat.userId !== session.user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const answerStr = String(answer ?? "");
    const isCancel =
      action === "cancel" || answerStr.trim().toLowerCase() === "cancel";

    // Verify there is an active run with a matching pending question
    let activeRun = ExecutionTracker.getActiveRun(chatId);

    if (!activeRun) {
      try {
        const { getTestSessionByChatId } = await import("@/lib/db/queries");
        const dbSession = await getTestSessionByChatId({ chatId });
        if (dbSession?.executionSnapshot) {
          activeRun = ExecutionTracker.restoreRun(
            dbSession.executionSnapshot as any
          );
        }
      } catch {
        /* non-fatal */
      }
    }

    if (!activeRun) {
      return Response.json(
        { error: "No active execution found for this chat." },
        { status: 404 }
      );
    }

    // Cancellation flow: WAITING_FOR_USER -> CANCELLING -> CANCELLED
    if (isCancel) {
      const cancelledRun = await ExecutionTracker.cancelRun({
        chatId,
        reason: "user_cancelled_clarification",
      });

      console.log(
        `[Clarification API] Run cancelled by user during question ${questionId} in chat ${chatId}`
      );

      return Response.json({
        cancelled: true,
        executionState: cancelledRun?.executionState ?? "CANCELLED",
        questionId,
        success: true,
      });
    }

    // Check if already answered (idempotent / duplicate request)
    const alreadyAnswered = activeRun.clarificationHistory?.find(
      (q) => q.questionId === questionId && q.isAnswered
    );
    if (alreadyAnswered) {
      return Response.json({
        alreadyAnswered: true,
        answer: alreadyAnswered.answer,
        executionState: activeRun.executionState,
        questionId,
        runId: activeRun.runId,
        success: true,
      });
    }

    // Validate run state
    if (activeRun.executionState !== "WAITING_FOR_USER") {
      return Response.json(
        {
          error: `Run is not currently waiting for user input (current state: ${activeRun.executionState}).`,
          executionState: activeRun.executionState,
        },
        { status: 409 }
      );
    }

    // Validate pending question ID
    if (
      !activeRun.pendingQuestion ||
      activeRun.pendingQuestion.questionId !== questionId
    ) {
      return Response.json(
        {
          error: `No pending question with ID ${questionId} found.`,
          pendingQuestionId: activeRun.pendingQuestion?.questionId || null,
        },
        { status: 404 }
      );
    }

    // Record the answer and resume execution atomically
    const updatedRun = ExecutionTracker.resumeWithAnswer({
      answer: answerStr,
      chatId,
      questionId,
    });

    if (!updatedRun) {
      return Response.json(
        { error: "Failed to record answer and resume execution." },
        { status: 500 }
      );
    }

    console.log(
      `[Clarification API] Answer received for question ${questionId} in chat ${chatId}: "${answerStr.slice(0, 100)}"`
    );

    return Response.json({
      answer: answerStr,
      executionState: updatedRun.executionState,
      questionId,
      runId: updatedRun.runId,
      success: true,
    });
  } catch (error) {
    console.error("[Clarification API] POST error:", error);
    return Response.json(
      { error: "Failed to process clarification answer" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/qa/clarification?chatId=xxx
 *
 * Returns the current pending clarification question (if any) for a chat.
 * Used by the UI to restore state after a page reload.
 */
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

  const { getChatById } = await import("@/lib/db/queries");
  const chat = await getChatById({ id: chatId });
  if (!chat || chat.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let activeRun = ExecutionTracker.getActiveRun(chatId);

  if (!activeRun) {
    // Try to restore from DB
    try {
      const { getTestSessionByChatId } = await import("@/lib/db/queries");
      const dbSession = await getTestSessionByChatId({ chatId });
      if (dbSession?.executionSnapshot) {
        activeRun = ExecutionTracker.restoreRun(
          dbSession.executionSnapshot as any
        );
      }
    } catch {
      /* non-fatal */
    }
  }

  if (!activeRun) {
    return Response.json({
      clarificationHistory: [],
      pendingQuestion: null,
    });
  }

  return Response.json({
    clarificationHistory: activeRun.clarificationHistory || [],
    executionState: activeRun.executionState,
    pendingQuestion: activeRun.pendingQuestion || null,
  });
}
