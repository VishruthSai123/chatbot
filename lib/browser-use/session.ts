import {
  createTestSession,
  getTestSessionByChatId,
  updateTestSessionStatus,
} from "@/lib/db/queries";
import { getBrowserUseClient, type TaskStepView } from "./client";

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isSameTarget(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(normalizeUrl(urlA));
    const b = new URL(normalizeUrl(urlB));
    return a.origin.toLowerCase() === b.origin.toLowerCase();
  } catch {
    return urlA.trim().toLowerCase() === urlB.trim().toLowerCase();
  }
}

export interface ActiveBrowserSession {
  browserSessionId: string;
  id: string;
  isExisting: boolean;
  liveUrl: string | null;
  targetUrl: string;
}

export interface RunBrowserTaskOptions {
  instruction: string;
  onStep?: (step: TaskStepView) => void | Promise<void>;
  sessionId: string;
}

export interface RunBrowserTaskResult {
  isSuccess: boolean | null;
  output: string | null;
  steps: TaskStepView[];
  taskId: string | null;
}

/**
 * Retrieves an active browser session for the given chatId, or creates a new one
 * on Browser Use Cloud with liveUrl and keeps it alive for multi-turn test persistence.
 */
export async function getOrCreateBrowserSession({
  chatId,
  targetUrl,
  projectId,
  browserScreenWidth = 1024,
  browserScreenHeight,
}: {
  chatId: string;
  targetUrl: string;
  projectId?: string;
  browserScreenWidth?: number;
  browserScreenHeight?: number;
}): Promise<ActiveBrowserSession> {
  const client = getBrowserUseClient();

  // 1. Check if a TestSession record already exists for this chat
  const existing = await getTestSessionByChatId({ chatId });

  if (
    existing?.browserSessionId &&
    existing.status !== "completed" &&
    existing.status !== "error"
  ) {
    const sameTarget = isSameTarget(existing.targetUrl, targetUrl);

    if (sameTarget) {
      // Reuse existing active session for the same target application
      try {
        const liveSession = await client.sessions.get(
          existing.browserSessionId
        );
        if (liveSession && liveSession.status === "active") {
          return {
            browserSessionId: existing.browserSessionId,
            id: existing.id,
            isExisting: true,
            liveUrl: liveSession.liveUrl ?? existing.liveUrl ?? null,
            targetUrl: existing.targetUrl,
          };
        }

        // Cloud session is no longer active (e.g. stopped, expired)
        console.log(
          `[BrowserUse] Existing session ${existing.browserSessionId} is ${liveSession?.status ?? "inactive"}. Marking completed in DB.`
        );
        await updateTestSessionStatus({
          id: existing.id,
          status: "completed",
        });
      } catch (checkError) {
        console.warn(
          `[BrowserUse] Failed to query existing session ${existing.browserSessionId}, marking completed in DB:`,
          checkError
        );
        await updateTestSessionStatus({
          id: existing.id,
          status: "completed",
        });
      }
    } else {
      // Target changed: terminate old cloud session cleanly to prevent resource leak
      console.log(
        `[BrowserUse] Target application changed from ${existing.targetUrl} to ${targetUrl}. Stopping old session ${existing.browserSessionId}...`
      );
      try {
        await client.sessions.stop(existing.browserSessionId);
      } catch (err) {
        console.warn("[BrowserUse] Error stopping previous session:", err);
      }
      await updateTestSessionStatus({
        id: existing.id,
        status: "completed",
      });
    }
  }

  // Adaptive screen sizing:
  // Default to 1024px width and 830px height (aspect ratio ~1.234)
  // matching the workspace panel dimensions (60% split on desktop/laptop displays).
  const finalWidth = browserScreenWidth ?? 1024;
  const finalHeight =
    browserScreenHeight ?? Math.round(finalWidth * (830 / 1024));

  // 2. Spawn a new session on Browser Use Cloud
  console.log(
    `[BrowserUse] Creating new browser session for ${targetUrl} (${finalWidth}x${finalHeight})...`
  );
  const newCloudSession = await client.sessions.create({
    browserScreenHeight: finalHeight,
    browserScreenWidth: finalWidth,
    enableRecording: true,
    keepAlive: true,
    persistMemory: true,
    startUrl: targetUrl,
  });

  const browserSessionId = newCloudSession.id;
  const liveUrl = newCloudSession.liveUrl ?? null;

  // 3. Persist new session link to Drizzle ORM
  const created = await createTestSession({
    browserSessionId,
    chatId,
    liveUrl: liveUrl ?? undefined,
    projectId,
    targetUrl,
  });

  await updateTestSessionStatus({
    browserSessionId,
    id: created.id,
    liveUrl: liveUrl ?? undefined,
    status: "active",
  });

  return {
    browserSessionId,
    id: created.id,
    isExisting: false,
    liveUrl,
    targetUrl,
  };
}

/**
 * Executes a task on the specified browser session, yielding each step as it occurs.
 */
export async function runBrowserTask({
  sessionId,
  instruction,
  onStep,
}: RunBrowserTaskOptions): Promise<RunBrowserTaskResult> {
  const client = getBrowserUseClient();
  const taskRun = client.run(instruction, { sessionId });
  const steps: TaskStepView[] = [];

  for await (const step of taskRun) {
    steps.push(step);
    if (onStep) {
      try {
        await onStep(step);
      } catch (err) {
        console.error("[BrowserUse] Error in onStep handler:", err);
      }
    }
  }

  const result = await taskRun;

  return {
    isSuccess: result.isSuccess ?? null,
    output:
      typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output ?? ""),
    steps,
    taskId: taskRun.taskId,
  };
}

/**
 * Gracefully terminates a browser session for a given chat and marks it completed in DB.
 */
export async function stopBrowserSession({ chatId }: { chatId: string }) {
  const existing = await getTestSessionByChatId({ chatId });
  if (!existing) {
    return { message: "No session found for this chat", success: false };
  }

  if (existing.browserSessionId) {
    try {
      const client = getBrowserUseClient();
      await client.sessions.stop(existing.browserSessionId);
    } catch (err) {
      console.warn(
        `[BrowserUse] Error stopping session ${existing.browserSessionId}:`,
        err
      );
    }
  }

  await updateTestSessionStatus({
    id: existing.id,
    status: "completed",
  });

  return { success: true };
}

/**
 * Fetches current session details directly from Browser Use Cloud.
 */
export async function getSessionDetails(browserSessionId: string) {
  const client = getBrowserUseClient();
  return await client.sessions.get(browserSessionId);
}
