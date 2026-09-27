import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import {
  createTestSession,
  getTestSessionByChatId,
  saveQAFinding,
  updateTestSessionStatus,
} from "@/lib/db/queries";
import { ExecutionTracker } from "@/lib/qa/execution-tracker";
import type { ChatMessage } from "@/lib/types";

type EvaluateTestResultProps = {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  chatId: string;
};

export const evaluateTestResult = ({
  dataStream,
  chatId,
}: EvaluateTestResultProps) =>
  tool({
    description:
      "Evaluate whether a QA test passed or failed based on the browser execution result. Call this AFTER runBrowserStep completes. Provide your honest assessment of the outcome. The verdict must be based on actual observed behavior, not assumptions.",
    execute: async ({
      status,
      title,
      summary,
      expected,
      actual,
      reproductionSteps,
      evidence,
      testSessionId,
      severity,
    }) => {
      try {
        // Discard evaluation only if user actively requested cancellation on this run
        const activeRun = ExecutionTracker.getActiveRun(chatId);
        const isActivelyCancelled =
          ExecutionTracker.isCancelRequested(chatId) ||
          activeRun?.executionState === "CANCELLING";

        const existingSession = await getTestSessionByChatId({ chatId }).catch(
          () => null
        );

        if (isActivelyCancelled) {
          console.log(
            `[evaluateTestResult] Discarding evaluation because run was actively cancelled for chat ${chatId}`
          );
          return {
            actual: "Test execution was stopped by user.",
            cancelled: true,
            expected: "Execution stopped",
            findingId: null,
            status: "uncertain",
            summary: "Test was stopped by user.",
            title: "Test Stopped",
          };
        }

        // HARD EXECUTION BARRIER: Never evaluate while WAITING_FOR_USER
        if (
          activeRun?.executionState === "WAITING_FOR_USER" ||
          activeRun?.pendingQuestion
        ) {
          console.warn(
            `[ExecutionGuard] runId=${activeRun?.runId} state=${activeRun?.executionState} blockedAction=evaluateTestResult`
          );
          return {
            actual: "Execution is waiting for user clarification.",
            blocked: true,
            expected: "User clarification must be answered before evaluation.",
            findingId: null,
            status: "blocked",
            summary:
              "Evaluation blocked: execution is currently waiting for user clarification.",
            title: "Evaluation Blocked",
          };
        }

        // Transition tracker to FINALIZING
        ExecutionTracker.recordFinalizing({ chatId });

        // Resolve a valid DB TestSession ID
        let resolvedTestSessionId: string | null = null;

        if (
          testSessionId &&
          existingSession &&
          (existingSession.id === testSessionId ||
            existingSession.browserSessionId === testSessionId)
        ) {
          resolvedTestSessionId = existingSession.id;
        } else if (existingSession) {
          resolvedTestSessionId = existingSession.id;
        } else {
          const newSession = await createTestSession({
            chatId,
            targetUrl: "https://app.local",
          });
          resolvedTestSessionId = newSession.id;
        }

        // Save finding to database
        const finding = await saveQAFinding({
          actualResult: actual,
          evidence: evidence ?? [],
          expectedResult: expected,
          reproductionSteps: reproductionSteps ?? [],
          severity: severity ?? "medium",
          testSessionId: resolvedTestSessionId,
          title,
          verdict: status === "blocked" ? "uncertain" : status,
        });

        // Authoritatively update DB TestSession status
        await updateTestSessionStatus({
          force: true,
          id: resolvedTestSessionId,
          status: "completed",
        }).catch((err) => {
          console.warn(
            "[evaluateTestResult] Error updating session status to completed:",
            err
          );
        });

        // Mark execution complete in tracker
        const completedRun = ExecutionTracker.completeRun({
          chatId,
          findingId: finding?.id ?? null,
          verdict: status,
        });

        // Stream finding to the client for rich UI rendering
        dataStream.write({
          data: {
            actual,
            evidence: evidence ?? [],
            expected,
            findingId: finding?.id ?? null,
            reproductionSteps: reproductionSteps ?? [],
            severity: severity ?? "medium",
            status,
            summary,
            title,
          },
          transient: true,
          type: "data-qa-finding",
        });

        // Stream final canonical execution state
        if (completedRun) {
          dataStream.write({
            data: {
              completedAt: completedRun.completedAt,
              currentAction: "Test completed",
              currentStep: completedRun.currentStep,
              executionState: "COMPLETED",
              findingId: finding?.id ?? null,
              lastActivityAt: completedRun.lastActivityAt,
              runId: completedRun.runId,
              sequence: completedRun.sequence,
              sessionId: completedRun.sessionId,
              startedAt: completedRun.startedAt,
              steps: completedRun.steps,
              verdict: status,
            },
            transient: true,
            type: "data-qa-execution",
          });
        }

        return {
          actual,
          evidence: evidence ?? [],
          expected,
          findingId: finding?.id ?? null,
          reproductionSteps: reproductionSteps ?? [],
          severity: severity ?? "medium",
          status,
          summary,
          title,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Evaluation error";
        ExecutionTracker.failRun({
          chatId,
          error: message,
          state: "FAILED",
        });

        dataStream.write({
          data: {
            currentAction: `Evaluation error: ${message}`,
            error: message,
            executionState: "FAILED",
            lastActivityAt: new Date().toISOString(),
            runId: "error",
            sequence: 999,
            sessionId: "",
            startedAt: new Date().toISOString(),
          },
          transient: true,
          type: "data-qa-execution",
        });

        return {
          actual,
          error: message,
          expected,
          findingId: null,
          status,
          summary,
          title,
        };
      }
    },
    inputSchema: z.object({
      actual: z.string().describe("What actually happened during the test"),
      evidence: z
        .array(
          z.object({
            description: z.string().optional(),
            type: z
              .enum([
                "screenshot",
                "recording",
                "url",
                "action",
                "console",
                "network",
                "text",
                "browser-state",
              ])
              .describe("Type of evidence"),
            value: z.string().describe("Evidence content or reference"),
          })
        )
        .optional()
        .describe("Supporting evidence from the browser session"),
      expected: z.string().describe("What was expected to happen"),
      reproductionSteps: z
        .array(z.string())
        .optional()
        .describe(
          "Steps to reproduce the finding (especially useful for failures)"
        ),
      severity: z
        .enum(["critical", "high", "medium", "low", "suggestion"])
        .optional()
        .describe("Severity of the finding"),
      status: z
        .enum(["pass", "fail", "uncertain", "blocked"])
        .describe("The verdict of the test"),
      summary: z
        .string()
        .describe("A brief 1-2 sentence summary of the finding"),
      testSessionId: z
        .string()
        .optional()
        .describe("The test session ID (from startTestSession)"),
      title: z
        .string()
        .describe("A short title for this finding (e.g. 'Login flow works')"),
    }),
  });
