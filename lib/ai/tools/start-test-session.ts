import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getOrCreateBrowserSession } from "@/lib/browser-use/session";
import type { ChatMessage } from "@/lib/types";

type StartTestSessionProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  chatId: string;
};

export const startTestSession = ({
  dataStream,
  chatId,
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
          chatId,
          targetUrl,
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

        // Push session data to the client — this triggers the browser artifact pane to open
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

        return {
          browserSessionId: browserSession.browserSessionId,
          liveUrl: browserSession.liveUrl,
          sessionId: browserSession.id,
          status: browserSession.isExisting ? "reused" : "created",
          targetUrl: browserSession.targetUrl,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        dataStream.write({
          data: `Browser session failed: ${message}`,
          transient: true,
          type: "data-qa-status",
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
