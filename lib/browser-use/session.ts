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
  onHeartbeat?: (elapsedSeconds: number) => void | Promise<void>;
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
  onHeartbeat,
  isCancelled,
}: RunBrowserTaskOptions): Promise<RunBrowserTaskResult> {
  const client = getBrowserUseClient();

  // 1. Immediately create task on Browser Use Cloud
  console.log(
    `[BrowserUse] Initiating cloud task on session ${sessionId}: "${instruction.slice(0, 80)}..."`
  );
  const created = await client.tasks.create({
    sessionId,
    task: instruction,
  });

  const taskId = created.id;
  console.log(`[BrowserUse] Cloud task created with ID: ${taskId}`);

  // 2. Publish taskId immediately so ExecutionTracker and DB snapshot have it
  onTaskId?.(taskId);

  // 3. Early check: Was cancellation requested while task was being created?
  if (isCancelled?.()) {
    console.log(
      `[BrowserUse] Cancellation was already requested for task ${taskId}. Halting immediately...`
    );
    try {
      await client.tasks.stop(taskId);
    } catch {
      /* non-fatal */
    }
    return {
      isStopped: true,
      isSuccess: false,
      output: "Task stopped by user",
      steps: [],
      taskId,
    };
  }

  const steps: TaskStepView[] = [];
  let seen = 0;
  const pollInterval = 1500;
  const startTime = Date.now();
  // Safe max timeout: Browser Use default is 5 mins (300,000ms)
  const timeoutMs = 300_000;
  const deadline = startTime + timeoutMs;

  try {
    while (Date.now() < deadline) {
      // Periodic check for cancellation requested during loop
      if (isCancelled?.()) {
        console.log(
          `[BrowserUse] Cancellation requested for task ${taskId}. Stopping remote execution...`
        );
        try {
          // biome-ignore lint/performance/noAwaitInLoops: sequential stop request
          await client.tasks.stop(taskId);
        } catch {
          /* non-fatal */
        }
        return {
          isStopped: true,
          isSuccess: false,
          output: "Task stopped by user",
          steps,
          taskId,
        };
      }

      let task: any;
      try {
        task = await client.tasks.get(taskId);
      } catch (err) {
        console.warn(`[BrowserUse] Polling task ${taskId} warning:`, err);
        await new Promise((r) => setTimeout(r, pollInterval));
        continue;
      }

      // Process any new steps arrived from cloud
      if (task.steps && Array.isArray(task.steps)) {
        for (let i = seen; i < task.steps.length; i += 1) {
          const step = task.steps[i];
          steps.push(step);
          if (onStep) {
            try {
              // biome-ignore lint/performance/noAwaitInLoops: sequential step dispatch
              await onStep(step);
            } catch (stepErr) {
              console.error("[BrowserUse] Error in onStep handler:", stepErr);
            }
          }
        }
        seen = task.steps.length;
      }

      // Check if stopped remotely
      if (task.status === "stopped" || isCancelled?.()) {
        if (isCancelled?.()) {
          try {
            await client.tasks.stop(taskId);
          } catch {
            /* non-fatal */
          }
        }
        return {
          isStopped: true,
          isSuccess: false,
          output: "Task stopped by user",
          steps,
          taskId,
        };
      }

      // Check if finished
      if (task.status === "finished") {
        return {
          isStopped: false,
          isSuccess: task.isSuccess ?? null,
          output:
            typeof task.output === "string"
              ? task.output
              : JSON.stringify(task.output ?? ""),
          steps,
          taskId,
        };
      }

      // Emit heartbeat to keep SSE connection alive and UI progress updated
      const elapsedSeconds = Math.max(
        1,
        Math.floor((Date.now() - startTime) / 1000)
      );
      if (onHeartbeat) {
        try {
          await onHeartbeat(elapsedSeconds);
        } catch {
          /* non-fatal */
        }
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      await new Promise((r) =>
        setTimeout(r, Math.min(pollInterval, remaining))
      );
    }

    throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
  } catch (error) {
    if (isCancelled?.()) {
      try {
        await client.tasks.stop(taskId);
      } catch {
        /* non-fatal */
      }
      return {
        isStopped: true,
        isSuccess: false,
        output: "Task stopped by user",
        steps,
        taskId,
      };
    }

    // Try stopping remote execution if timed out or failed
    try {
      await client.tasks.stop(taskId);
    } catch {
      /* non-fatal */
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
