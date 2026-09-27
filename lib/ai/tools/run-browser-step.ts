import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import {
  isBrowserSessionUsable,
  type RunBrowserTaskResult,
  restartBrowserSession,
  runBrowserTask,
} from "@/lib/browser-use/session";
import { ExecutionTracker } from "@/lib/qa/execution-tracker";
import type { ChatMessage } from "@/lib/types";

type RunBrowserStepProps = {
  chatId: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

export const runBrowserStep = ({ chatId, dataStream }: RunBrowserStepProps) =>
  tool({
    description:
      "Execute a browser task through Browser Use on an active session. Provide a clear, specific instruction of what to do in the browser. The browser session must already exist (call startTestSession first). Returns the execution result including success status and output.",
    execute: async ({ browserSessionId, instruction }) => {
      try {
        const initialAction = `Executing: ${instruction.slice(0, 120)}`;
        dataStream.write({
          data: `${initialAction}...`,
          transient: true,
          type: "data-qa-status",
        });

        const { getTestSessionByChatId } = await import("@/lib/db/queries");
        const existingSession = await getTestSessionByChatId({
          chatId,
        }).catch(() => null);
        let activeRun = ExecutionTracker.getActiveRun(chatId);

        const isCancelled =
          ExecutionTracker.isCancelRequested(chatId) ||
          activeRun?.executionState === "CANCELLING";

        if (
          isCancelled &&
          activeRun?.executionState !== "RESUMING" &&
          activeRun?.executionState !== "RUNNING"
        ) {
          console.log(
            `[runBrowserStep] Execution blocked because session ${chatId} is cancelled.`
          );
          return {
            isStopped: true,
            output:
              "Test execution was stopped by user. To continue, say 'Resume' or 'Continue'.",
            stepCount: 0,
            success: false,
            taskId: null,
          };
        }

        // Ensure session is alive and usable before launching task
        let effectiveSessionId = browserSessionId;
        const isSessionAlive = await isBrowserSessionUsable(effectiveSessionId);

        if (!isSessionAlive) {
          console.log(
            `[runBrowserStep] Session ${effectiveSessionId} is ended or unreachable. Recovering with fresh session...`
          );
          dataStream.write({
            data: "Restoring browser session...",
            transient: true,
            type: "data-qa-status",
          });

          const recoveredSession = await restartBrowserSession({
            chatId,
            targetUrl: existingSession?.targetUrl,
          });

          effectiveSessionId = recoveredSession.browserSessionId;

          dataStream.write({
            data: {
              browserScreenHeight: recoveredSession.browserScreenHeight,
              browserScreenWidth: recoveredSession.browserScreenWidth,
              browserSessionId: recoveredSession.browserSessionId,
              id: recoveredSession.id,
              liveUrl: recoveredSession.liveUrl ?? "",
              status: "live",
              targetUrl: recoveredSession.targetUrl,
            },
            transient: true,
            type: "data-browser-session",
          });
        }

        // Ensure run is active in tracker
        if (
          !activeRun ||
          activeRun.executionState === "COMPLETED" ||
          activeRun.executionState === "FAILED" ||
          activeRun.executionState === "CANCELLED" ||
          activeRun.executionState === "RESUMING"
        ) {
          activeRun = ExecutionTracker.startRun({
            browserSessionId: effectiveSessionId,
            chatId,
            sessionId: existingSession?.id || effectiveSessionId,
            targetUrl: existingSession?.targetUrl || "https://localhost",
          });
        }

        // Unconditionally ensure DB test session is marked active
        if (existingSession?.id) {
          const { updateTestSessionStatus } = await import("@/lib/db/queries");
          await updateTestSessionStatus({
            force: true,
            id: existingSession.id,
            status: "active",
          }).catch(() => null);
        }

        // Stream initial running state
        dataStream.write({
          data: {
            currentAction: initialAction,
            currentStep: activeRun.currentStep ?? 1,
            executionState: "RUNNING",
            lastActivityAt: activeRun.lastActivityAt,
            runId: activeRun.runId,
            sequence: activeRun.sequence,
            sessionId: activeRun.sessionId,
            startedAt: activeRun.startedAt,
            steps: activeRun.steps,
          },
          transient: true,
          type: "data-qa-execution",
        });

        let stepCount = 0;

        const executeTaskWithSession = async (sessId: string) => {
          return await runBrowserTask({
            chatId,
            instruction,
            isCancelled: () => ExecutionTracker.isCancelRequested(chatId),
            onDownload: (download) => {
              // Stream download events to the frontend
              dataStream.write({
                data: download,
                transient: true,
                type: "data-qa-download",
              });
            },
            onHeartbeat: (elapsedSeconds) => {
              // Keep SSE connection alive on long steps without spamming state or overwriting action text
              if (elapsedSeconds > 0 && elapsedSeconds % 15 === 0) {
                dataStream.write({
                  data: "Executing browser action...",
                  transient: true,
                  type: "data-qa-status",
                });
              }
            },
            onStep: (step) => {
              stepCount += 1;

              const rawAction =
                (typeof step.nextGoal === "string" && step.nextGoal.trim()) ||
                (typeof step.evaluationPreviousGoal === "string" &&
                  step.evaluationPreviousGoal.trim()) ||
                (typeof (step as any).output === "string" &&
                  (step as any).output.trim()) ||
                `Step ${stepCount}`;

              const safeAction = rawAction || `Step ${stepCount}`;
              const urlText =
                (step as any).url ?? (step as any).currentUrl ?? undefined;

              // Update authoritative execution tracker
              const updatedRun = ExecutionTracker.updateStep({
                action: safeAction,
                chatId,
                number: stepCount,
                status: "running",
                url: urlText,
              });

              // Stream status and step delta
              dataStream.write({
                data: safeAction,
                transient: true,
                type: "data-qa-status",
              });

              dataStream.write({
                data: {
                  action: safeAction,
                  number: stepCount,
                  status: "running" as const,
                  url: urlText,
                },
                transient: true,
                type: "data-qa-step",
              });

              // Stream full execution snapshot
              if (updatedRun) {
                dataStream.write({
                  data: {
                    currentAction: safeAction,
                    currentStep: stepCount,
                    executionState: updatedRun.executionState,
                    lastActivityAt: updatedRun.lastActivityAt,
                    runId: updatedRun.runId,
                    sequence: updatedRun.sequence,
                    sessionId: updatedRun.sessionId,
                    startedAt: updatedRun.startedAt,
                    steps: updatedRun.steps,
                  },
                  transient: true,
                  type: "data-qa-execution",
                });
              }
            },
            onTaskId: (taskId) => {
              if (activeRun) {
                ExecutionTracker.setActiveTaskId(
                  chatId,
                  activeRun.runId,
                  taskId
                );
              }
            },
            runId: activeRun?.runId,
            sessionId: sessId,
          });
        };

        let result: RunBrowserTaskResult;
        try {
          result = await executeTaskWithSession(effectiveSessionId);
        } catch (firstErr) {
          const firstMsg =
            firstErr instanceof Error ? firstErr.message : String(firstErr);
          const isSessionDead =
            firstMsg.toLowerCase().includes("session") &&
            (firstMsg.toLowerCase().includes("not found") ||
              firstMsg.toLowerCase().includes("stopped") ||
              firstMsg.toLowerCase().includes("expired") ||
              firstMsg.toLowerCase().includes("inactive") ||
              firstMsg.toLowerCase().includes("ended") ||
              firstMsg.toLowerCase().includes("closed") ||
              firstMsg.toLowerCase().includes("404"));

          if (isSessionDead && !ExecutionTracker.isCancelRequested(chatId)) {
            console.log(
              `[runBrowserStep] Session ${effectiveSessionId} died during execution. Restarting browser and retrying prompt...`
            );
            dataStream.write({
              data: "Session ended. Restarting browser session...",
              transient: true,
              type: "data-qa-status",
            });

            const freshSession = await restartBrowserSession({
              chatId,
              targetUrl: existingSession?.targetUrl,
            });

            dataStream.write({
              data: {
                browserScreenHeight: freshSession.browserScreenHeight,
                browserScreenWidth: freshSession.browserScreenWidth,
                browserSessionId: freshSession.browserSessionId,
                id: freshSession.id,
                liveUrl: freshSession.liveUrl ?? "",
                status: "live",
                targetUrl: freshSession.targetUrl,
              },
              transient: true,
              type: "data-browser-session",
            });

            result = await executeTaskWithSession(
              freshSession.browserSessionId
            );
          } else {
            throw firstErr;
          }
        }

        // If task was stopped/cancelled by user
        if (result.isStopped || ExecutionTracker.isCancelRequested(chatId)) {
          const cancelledRun = await ExecutionTracker.cancelRun({
            chatId,
            reason: "user_stopped",
          });

          // Halts streamText so the LLM does not execute subsequent tool calls in background
          ExecutionTracker.abortChat(chatId, "user_stopped");

          dataStream.write({
            data: "Test execution stopped by user.",
            transient: true,
            type: "data-qa-status",
          });

          if (cancelledRun) {
            dataStream.write({
              data: {
                cancellationReason: "user_stopped",
                currentAction: "Test stopped by user",
                currentStep: stepCount,
                executionState: "CANCELLED",
                lastActivityAt: cancelledRun.lastActivityAt,
                lastConfirmedAction: cancelledRun.lastConfirmedAction,
                runId: cancelledRun.runId,
                sequence: cancelledRun.sequence,
                sessionId: cancelledRun.sessionId,
                startedAt: cancelledRun.startedAt,
                steps: cancelledRun.steps,
              },
              transient: true,
              type: "data-qa-execution",
            });
          }

          return {
            isStopped: true,
            output: `Test execution was stopped by the user after ${stepCount} browser steps. Last confirmed action: "${cancelledRun?.lastConfirmedAction || "Initial navigation"}". The browser remains open at this exact page state. To resume, the user can say "Continue" or "Resume from where you stopped".`,
            stepCount,
            success: false,
            taskId: result.taskId,
          };
        }

        // Mark current sub-step and overall execution as WAITING for verification
        const waitingAction = result.isSuccess
          ? "Browser action completed. Analyzing outcome..."
          : "Browser action finished with warnings. Verifying state...";

        const waitingRun = ExecutionTracker.recordWaiting({
          chatId,
          currentAction: waitingAction,
        });

        dataStream.write({
          data: {
            action: result.isSuccess
              ? "Task completed successfully"
              : "Task completed",
            number: stepCount,
            status: "completed" as const,
          },
          transient: true,
          type: "data-qa-step",
        });

        if (waitingRun) {
          dataStream.write({
            data: {
              currentAction: waitingAction,
              currentStep: stepCount,
              executionState: "WAITING",
              lastActivityAt: waitingRun.lastActivityAt,
              runId: waitingRun.runId,
              sequence: waitingRun.sequence,
              sessionId: waitingRun.sessionId,
              startedAt: waitingRun.startedAt,
              steps: waitingRun.steps,
            },
            transient: true,
            type: "data-qa-execution",
          });
        }

        return {
          output: result.output,
          stepCount: result.steps.length,
          success: result.isSuccess,
          taskId: result.taskId,
        };
      } catch (error) {
        if (ExecutionTracker.isCancelRequested(chatId)) {
          return {
            isStopped: true,
            output: "Test execution was stopped by the user.",
            stepCount: 0,
            success: false,
            taskId: null,
          };
        }

        const message =
          error instanceof Error ? error.message : "Unknown browser error";
        const isTimeout =
          message.toLowerCase().includes("timeout") ||
          message.toLowerCase().includes("did not complete within");

        const failedRun = ExecutionTracker.failRun({
          chatId,
          error: message,
          state: isTimeout ? "TIMED_OUT" : "FAILED",
        });

        dataStream.write({
          data: `Browser task error: ${message}`,
          transient: true,
          type: "data-qa-status",
        });

        if (failedRun) {
          dataStream.write({
            data: {
              currentAction: isTimeout
                ? "Task timed out"
                : `Failed: ${message}`,
              error: message,
              executionState: isTimeout ? "TIMED_OUT" : "FAILED",
              lastActivityAt: failedRun.lastActivityAt,
              runId: failedRun.runId,
              sequence: failedRun.sequence,
              sessionId: failedRun.sessionId,
              startedAt: failedRun.startedAt,
              steps: failedRun.steps,
            },
            transient: true,
            type: "data-qa-execution",
          });
        }

        return {
          error: message,
          output: null,
          stepCount: 0,
          success: false,
          taskId: null,
        };
      }
    },
    inputSchema: z.object({
      browserSessionId: z
        .string()
        .describe("The Browser Use session ID returned by startTestSession"),
      instruction: z
        .string()
        .describe(
          "A clear, specific instruction for what to do in the browser. Example: 'Navigate to the login page, enter test@example.com as email, enter password123, and click Submit.'"
        ),
    }),
  });
