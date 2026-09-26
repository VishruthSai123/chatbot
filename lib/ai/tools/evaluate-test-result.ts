import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import {
  createTestSession,
  getTestSessionByChatId,
  saveQAFinding,
} from "@/lib/db/queries";
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
        // Resolve a valid DB TestSession ID
        let resolvedTestSessionId: string | null = null;
        const existingSession = await getTestSessionByChatId({ chatId });

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
