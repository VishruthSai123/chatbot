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
  browserScreenHeight?: number;
  browserScreenWidth?: number;
  browserSessionId: string;
  id: string;
  isExisting: boolean;
  liveUrl: string | null;
  targetUrl: string;
}

export interface RunBrowserTaskOptions {
  instruction: string;
  isCancelled?: () => boolean;
  onStep?: (step: TaskStepView) => void | Promise<void>;
  onTaskId?: (taskId: string) => void;
  sessionId: string;
}

export interface RunBrowserTaskResult {
  isStopped?: boolean;
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
  browserScreenWidth,
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
            browserScreenHeight:
              (liveSession as any).browserScreenHeight ?? browserScreenHeight,
            browserScreenWidth:
              (liveSession as any).browserScreenWidth ?? browserScreenWidth,
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
  // Dynamically use the pre-computed dimensions matching the user's screen ratio.
  // Fall back to 1100x1440 (~1:1.3) to prevent letterboxing in the QA preview.
  let finalWidth = browserScreenWidth ? Math.round(browserScreenWidth) : 1100;
  let finalHeight = browserScreenHeight
    ? Math.round(browserScreenHeight)
    : Math.round(finalWidth * (1440 / 1100));

  // Clamp within safe browser limits (min 360px, max 3840px / 2160px)
  finalWidth = Math.min(Math.max(finalWidth, 360), 3840);
  finalHeight = Math.min(Math.max(finalHeight, 360), 2160);

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
    browserScreenHeight: finalHeight,
    browserScreenWidth: finalWidth,
    browserSessionId,
    id: created.id,
    isExisting: false,
    liveUrl,
    targetUrl,
  };
}

/**
 * Executes a task on the specified browser session, yielding each step as it occurs.
 * Supports real-time cancellation check to stop cloud task promptly without killing the browser.
 */
export async function runBrowserTask({
  sessionId,
  instruction,
  onStep,
  onTaskId,
  isCancelled,
}: RunBrowserTaskOptions): Promise<RunBrowserTaskResult> {
  const client = getBrowserUseClient();
  const taskRun = client.run(instruction, {
    sessionId,
  });
  const steps: TaskStepView[] = [];

  let recordedTaskId: string | null = null;
  const checkTaskId = () => {
    if (!recordedTaskId && taskRun.taskId) {
      recordedTaskId = taskRun.taskId;
      onTaskId?.(recordedTaskId);
    }
  };

  try {
    for await (const step of taskRun) {
      checkTaskId();

      // Check if cancellation was requested while running
      if (isCancelled?.()) {
        console.log(
          `[BrowserUse] Cancellation detected in runBrowserTask. Stopping active task ${taskRun.taskId}...`
        );
        if (taskRun.taskId) {
          try {
            await client.tasks.stop(taskRun.taskId);
          } catch {
            /* ignore if already stopped */
          }
        }
        return {
          isStopped: true,
          isSuccess: false,
          output: "Task stopped by user",
          steps,
          taskId: recordedTaskId || taskRun.taskId,
        };
      }

      steps.push(step);
      if (onStep) {
        try {
          await onStep(step);
        } catch (err) {
          console.error("[BrowserUse] Error in onStep handler:", err);
        }
      }

      if (isCancelled?.()) {
        if (taskRun.taskId) {
          try {
            await client.tasks.stop(taskRun.taskId);
          } catch {
            /* non-fatal */
          }
        }
        return {
          isStopped: true,
          isSuccess: false,
          output: "Task stopped by user",
          steps,
          taskId: recordedTaskId || taskRun.taskId,
        };
      }
    }

    checkTaskId();

    if (isCancelled?.()) {
      return {
        isStopped: true,
        isSuccess: false,
        output: "Task stopped by user",
        steps,
        taskId: recordedTaskId || taskRun.taskId,
      };
    }

    const result = await taskRun;

    return {
      isStopped: false,
      isSuccess: result.isSuccess ?? null,
      output:
        typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output ?? ""),
      steps,
      taskId: recordedTaskId || taskRun.taskId,
    };
  } catch (error) {
    if (isCancelled?.()) {
      return {
        isStopped: true,
        isSuccess: false,
        output: "Task stopped by user",
        steps,
        taskId: recordedTaskId || taskRun.taskId,
      };
    }

    // If the task timed out or failed, attempt to stop remote task execution
    if (taskRun.taskId) {
      try {
        await client.tasks.stop(taskRun.taskId);
      } catch {
        /* non-fatal */
      }
    }
    throw error;
  }
}

/**
 * Safely stops only the active running task on Browser Use Cloud,
 * preserving the underlying browser session and its URL/DOM/auth state.
 */
export async function stopActiveTask({ chatId }: { chatId: string }) {
  const existing = await getTestSessionByChatId({ chatId });
  if (!existing) {
    return { message: "No session found for this chat", success: false };
  }

  await updateTestSessionStatus({
    id: existing.id,
    status: "cancelled",
  });

  return { success: true };
}

/**
 * Terminates the browser session for a given chat.
 * If terminateCloudSession is false, preserves the cloud browser instance for continuation.
 */
export async function stopBrowserSession({
  chatId,
  terminateCloudSession = false,
}: {
  chatId: string;
  terminateCloudSession?: boolean;
}) {
  const existing = await getTestSessionByChatId({ chatId });
  if (!existing) {
    return { message: "No session found for this chat", success: false };
  }

  if (terminateCloudSession && existing.browserSessionId) {
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
    status: terminateCloudSession ? "completed" : "cancelled",
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
