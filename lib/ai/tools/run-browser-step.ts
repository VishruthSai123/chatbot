import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { runBrowserTask } from "@/lib/browser-use/session";
import type { ChatMessage } from "@/lib/types";

type RunBrowserStepProps = {
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

export const runBrowserStep = ({ dataStream }: RunBrowserStepProps) =>
  tool({
    description:
      "Execute a browser task through Browser Use on an active session. Provide a clear, specific instruction of what to do in the browser. The browser session must already exist (call startTestSession first). Returns the execution result including success status and output.",
    execute: async ({ browserSessionId, instruction }) => {
      try {
        dataStream.write({
          data: `Executing: ${instruction.slice(0, 120)}...`,
          transient: true,
          type: "data-qa-status",
        });

        let stepCount = 0;

        const result = await runBrowserTask({
          instruction,
          onStep: (step) => {
            stepCount += 1;

            // Extract action description from the step object safely
            const actionText =
              (step as any).nextGoal ??
              (step as any).evaluationPreviousGoal ??
              (step as any).output ??
              `Step ${stepCount}`;

            const urlText =
              (step as any).url ?? (step as any).currentUrl ?? undefined;

            dataStream.write({
              data: {
                action:
                  typeof actionText === "string"
                    ? actionText
                    : String(actionText),
                number: stepCount,
                status: "running" as const,
                url: urlText,
              },
              transient: true,
              type: "data-qa-step",
            });
          },
          sessionId: browserSessionId,
        });

        // Write final status
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

        return {
          output: result.output,
          stepCount: result.steps.length,
          success: result.isSuccess,
          taskId: result.taskId,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown browser error";

        dataStream.write({
          data: `Browser task error: ${message}`,
          transient: true,
          type: "data-qa-status",
        });

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
