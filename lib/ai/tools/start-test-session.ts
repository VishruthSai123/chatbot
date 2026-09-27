import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getOrCreateBrowserSession } from "@/lib/browser-use/session";
import { ExecutionTracker } from "@/lib/qa/execution-tracker";
import type { ChatMessage } from "@/lib/types";

type StartTestSessionProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  chatId: string;
  browserDimensions?: { width: number; height: number };
};

export const startTestSession = ({
  dataStream,
  chatId,
  browserDimensions,
}: Omit<StartTestSessionProps, "session">) =>
  tool({
    description:
      "Create or retrieve a live cloud browser session for QA testing. Call this before runBrowserStep when testing a new URL or when no session exists yet. Returns browserSessionId needed for runBrowserStep.",
    execute: async ({ targetUrl }) => {
      try {
        dataStream.write({
          data: "Starting browser session...",
          transient: true,
          type: "data-qa-status",
        });

        const browserSession = await getOrCreateBrowserSession({
          browserScreenHeight: browserDimensions?.height,
          browserScreenWidth: browserDimensions?.width,
          chatId,
          targetUrl,
        });

        const run = ExecutionTracker.startRun({
          browserSessionId: browserSession.browserSessionId,
          chatId,
          sessionId: browserSession.id,
          targetUrl: browserSession.targetUrl,
        });

        // Push standard artifact initiation parts
        dataStream.write({
          data: "browser",
          transient: true,
          type: "data-kind",
        });

        dataStream.write({
          data: browserSession.id,
          transient: true,
          type: "data-id",
        });

        dataStream.write({
          data: browserSession.targetUrl || "Live Browser",
          transient: true,
          type: "data-title",
        });

        // Push session data to the client — triggers browser artifact pane to open
        dataStream.write({
          data: {
            browserSessionId: browserSession.browserSessionId,
            id: browserSession.id,
            liveUrl: browserSession.liveUrl ?? "",
            status: "live",
            targetUrl: browserSession.targetUrl,
          },
          transient: true,
          type: "data-browser-session",
        });

        // Stream authoritative execution state
        dataStream.write({
          data: {
            currentAction: "Connected to live browser session",
            currentStep: 0,
            executionState: "STARTING",
            lastActivityAt: run.lastActivityAt,
            runId: run.runId,
            sequence: run.sequence,
            sessionId: browserSession.id,
            startedAt: run.startedAt,
            steps: run.steps,
          },
          transient: true,
          type: "data-qa-execution",
        });

        return {
          browserSessionId: browserSession.browserSessionId,
          liveUrl: browserSession.liveUrl,
          runId: run.runId,
          sessionId: browserSession.id,
          status: browserSession.isExisting ? "reused" : "created",
          targetUrl: browserSession.targetUrl,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        ExecutionTracker.failRun({
          chatId,
          error: message,
          state: "FAILED",
        });

        dataStream.write({
          data: `Browser session failed: ${message}`,
          transient: true,
          type: "data-qa-status",
        });

        dataStream.write({
          data: {
            currentAction: `Connection failed: ${message}`,
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
          error: message,
          status: "error",
        };
      }
    },
    inputSchema: z.object({
      targetUrl: z
        .string()
        .url()
        .describe(
          "The full URL of the web application to test (e.g. https://example.com/login)"
        ),
    }),
  });
