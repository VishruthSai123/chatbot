import { auth } from "@/app/(auth)/auth";
import { ExecutionTracker } from "@/lib/qa/execution-tracker";

/**
 * POST /api/qa/clarification
 *
 * Receives the user's answer to a pending clarification question.
 * Updates the execution tracker with the answer, which unblocks the
 * polling loop in the requestUserClarification tool.
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { chatId, questionId, answer } = body;

    if (!chatId || !questionId || answer === undefined || answer === null) {
      return Response.json(
        {
          error: "chatId, questionId, and answer are required",
        },
        { status: 400 }
      );
    }

    const answerStr = String(answer);

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

    if (
      !activeRun.pendingQuestion ||
      activeRun.pendingQuestion.questionId !== questionId
    ) {
      // Check if already answered (idempotent)
      const alreadyAnswered = activeRun.clarificationHistory?.find(
        (q) => q.questionId === questionId && q.isAnswered
      );
      if (alreadyAnswered) {
        return Response.json({
          alreadyAnswered: true,
          answer: alreadyAnswered.answer,
          success: true,
        });
      }

      return Response.json(
        {
          error: `No pending question with ID ${questionId} found.`,
          pendingQuestionId: activeRun.pendingQuestion?.questionId || null,
        },
        { status: 404 }
      );
    }

    // Record the answer and resume execution
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

  const activeRun = ExecutionTracker.getActiveRun(chatId);

  if (!activeRun) {
    // Try to restore from DB
    try {
      const { getTestSessionByChatId } = await import("@/lib/db/queries");
      const dbSession = await getTestSessionByChatId({ chatId });
      if (dbSession?.executionSnapshot) {
        const snapshot = dbSession.executionSnapshot as any;
        return Response.json({
          clarificationHistory: snapshot.clarificationHistory || [],
          pendingQuestion: snapshot.pendingQuestion || null,
        });
      }
    } catch {
      /* non-fatal */
    }

    return Response.json({
      clarificationHistory: [],
      pendingQuestion: null,
    });
  }

  return Response.json({
    clarificationHistory: activeRun.clarificationHistory || [],
    pendingQuestion: activeRun.pendingQuestion || null,
  });
}
