import { getBrowserUseClient } from "@/lib/browser-use/client";
import { generateUUID } from "@/lib/utils";
import {
  canTransitionState,
  type DownloadItem,
  type ExecutionRecord,
  type ExecutionStep,
  isIrreversibleExecutionState,
  isStoppedOrPausedState,
} from "./execution-types";

interface GlobalQARunRegistry {
  abortControllers: Map<string, AbortController>;
  activeRunsByChat: Map<string, ExecutionRecord>;
  runsById: Map<string, ExecutionRecord>;
}

const globalForQA = globalThis as unknown as {
  __qaRegistry?: GlobalQARunRegistry;
};

if (!globalForQA.__qaRegistry) {
  globalForQA.__qaRegistry = {
    abortControllers: new Map(),
    activeRunsByChat: new Map(),
    runsById: new Map(),
  };
}

if (!globalForQA.__qaRegistry.abortControllers) {
  globalForQA.__qaRegistry.abortControllers = new Map();
}

const registry = globalForQA.__qaRegistry;

/**
 * Safely writes the current execution record snapshot to the database
 * to guarantee that state, completed steps, and context survive reloads.
 */
async function persistExecutionSnapshot(run: ExecutionRecord): Promise<void> {
  try {
    if (!run.sessionId) {
      return;
    }
    const dbStatus =
      run.executionState === "COMPLETED"
        ? "completed"
        : run.executionState === "FAILED" || run.executionState === "TIMED_OUT"
          ? "error"
          : run.executionState === "CANCELLED"
            ? "cancelled"
            : run.executionState === "PAUSED"
              ? "paused"
              : "active";

    const { updateTestSessionExecutionSnapshot } = await import(
      "@/lib/db/queries"
    );

    await updateTestSessionExecutionSnapshot({
      executionSnapshot: run,
      id: run.sessionId,
      status: dbStatus,
    });
  } catch (err: any) {
    // Non-fatal if DB is unreachable or during unit tests importing outside Next server runtime
    const msg = String(err?.message || err);
    if (
      msg.includes("server-only") ||
      msg.includes("Client Component module")
    ) {
      return;
    }
    console.warn(
      `[ExecutionTracker] Could not persist snapshot for session ${run.sessionId}:`,
      err
    );
  }
}

/**
 * Initializes or re-anchors an authoritative run for a chat.
 * Preserves completed steps and context when continuing from a cancelled or paused run.
 */
function startRun({
  chatId,
  targetUrl,
  sessionId,
  browserSessionId,
  runId,
  originalIntent,
}: {
  chatId: string;
  targetUrl: string;
  sessionId: string;
  browserSessionId?: string;
  runId?: string;
  originalIntent?: string;
}): ExecutionRecord {
  const existing = registry.activeRunsByChat.get(chatId);

  // If continuing an existing session that was paused or still active:
  if (
    existing &&
    existing.sessionId === sessionId &&
    existing.executionState !== "CANCELLED" &&
    existing.executionState !== "CANCELLING"
  ) {
    existing.lastActivityAt = new Date().toISOString();
    existing.isCancelRequested = false;
    if (browserSessionId && !existing.browserSessionId) {
      existing.browserSessionId = browserSessionId;
    }
    if (originalIntent && !existing.originalIntent) {
      existing.originalIntent = originalIntent;
    }

    if (canTransitionState(existing.executionState, "STARTING")) {
      existing.executionState = "STARTING";
      existing.currentAction =
        existing.steps.length > 0
          ? `Continuing test from step ${existing.steps.length + 1}...`
          : "Initializing browser session...";
      existing.sequence += 1;
    }

    persistExecutionSnapshot(existing);
    return existing;
  }

  const newRunId = runId || generateUUID();
  const now = new Date().toISOString();

  const record: ExecutionRecord = {
    activeTaskId: null,
    browserSessionId,
    chatId,
    currentAction: "Initializing browser session...",
    downloads: existing?.downloads ? [...existing.downloads] : [],
    executionState: "STARTING",
    isCancelRequested: false,
    lastActivityAt: now,
    originalIntent,
    runId: newRunId,
    sequence: 1,
    sessionId,
    startedAt: now,
    steps: [],
    targetUrl,
  };

  registry.activeRunsByChat.set(chatId, record);
  registry.runsById.set(newRunId, record);

  persistExecutionSnapshot(record);
  return record;
}

function registerAbortController(chatId: string, controller: AbortController) {
  registry.abortControllers.set(chatId, controller);
}

function unregisterAbortController(chatId: string) {
  registry.abortControllers.delete(chatId);
}

function abortChat(chatId: string, reason?: string) {
  const controller = registry.abortControllers.get(chatId);
  if (controller && !controller.signal.aborted) {
    try {
      controller.abort(reason || "user_stopped");
    } catch {
      /* non-fatal */
    }
  }
}

function setActiveTaskId(chatId: string, _runId: string, taskId: string) {
  const run = registry.activeRunsByChat.get(chatId);
  if (run) {
    run.activeTaskId = taskId;
    run.lastActivityAt = new Date().toISOString();

    // Critical race check: If cancellation was already requested while task creation was in-flight,
    // immediately stop the cloud task now that we have its ID!
    if (
      run.isCancelRequested ||
      run.executionState === "CANCELLING" ||
      run.executionState === "CANCELLED"
    ) {
      console.log(
        `[ExecutionTracker] Run was already cancelled. Halting late-registered task ${taskId}...`
      );
      try {
        const client = getBrowserUseClient();
        client.tasks.stop(taskId).catch((err) => {
          console.warn(
            `[ExecutionTracker] Error stopping late task ${taskId}:`,
            err
          );
        });
      } catch (err) {
        console.warn(
          `[ExecutionTracker] Failed to get client to stop late task ${taskId}:`,
          err
        );
      }
    }
  }
}

/**
 * Checks whether cancellation or stop was requested for this chat's active run.
 */
function isCancelRequested(chatId: string): boolean {
  const run = registry.activeRunsByChat.get(chatId);
  if (!run) {
    return false;
  }
  return (
    run.isCancelRequested === true ||
    run.executionState === "CANCELLING" ||
    run.executionState === "CANCELLED"
  );
}

/**
 * Records step progress from Browser Use SDK.
 * Respects active cancellation requests and idempotency.
 */
function updateStep({
  chatId,
  runId,
  number,
  action,
  url,
  status = "running",
  error,
}: {
  chatId: string;
  runId?: string;
  number: number;
  action: string;
  url?: string;
  status?: "running" | "completed" | "failed";
  error?: string;
}): ExecutionRecord | null {
  const run = registry.activeRunsByChat.get(chatId);
  if (!run) {
    return null;
  }
  if (runId && run.runId !== runId) {
    return null;
  }

  // If cancellation was requested, do NOT revert to RUNNING
  if (
    isCancelRequested(chatId) ||
    !canTransitionState(run.executionState, "RUNNING")
  ) {
    return run;
  }

  run.executionState = "RUNNING";
  run.currentStep = number;
  run.currentAction = action;
  run.lastConfirmedAction = action;
  run.lastActivityAt = new Date().toISOString();
  run.sequence += 1;

  // Mark all previous steps as completed
  for (const existingStep of run.steps) {
    if (existingStep.number < number && existingStep.status === "running") {
      existingStep.status = "completed";
    }
  }

  const existingStepIdx = run.steps.findIndex((s) => s.number === number);
  const stepData: ExecutionStep = {
    action,
    error,
    number,
    status,
    timestamp: run.lastActivityAt,
    url:
      url ||
      (existingStepIdx >= 0 ? run.steps[existingStepIdx].url : undefined),
  };

  if (existingStepIdx >= 0) {
    run.steps[existingStepIdx] = stepData;
  } else {
    run.steps.push(stepData);
  }

  persistExecutionSnapshot(run).catch(() => {
    /* non-fatal */
  });

  return run;
}

/**
 * Transitions execution to WAITING (Browser Use completed task, awaiting LLM verification).
 */
function recordWaiting({
  chatId,
  runId,
  currentAction,
}: {
  chatId: string;
  runId?: string;
  currentAction?: string;
}): ExecutionRecord | null {
  const run = registry.activeRunsByChat.get(chatId);
  if (!run) {
    return null;
  }
  if (runId && run.runId !== runId) {
    return null;
  }

  // Do not override cancellation or terminal states
  if (
    isCancelRequested(chatId) ||
    !canTransitionState(run.executionState, "WAITING")
  ) {
    return run;
  }

  run.executionState = "WAITING";
  if (currentAction) {
    run.currentAction = currentAction;
  }
  run.lastActivityAt = new Date().toISOString();
  run.sequence += 1;

  // Mark all steps completed since browser task is done
  for (const step of run.steps) {
    if (step.status === "running") {
      step.status = "completed";
    }
  }

  persistExecutionSnapshot(run);
  return run;
}

/**
 * Transitions to FINALIZING (assertion evaluation in progress).
 */
function recordFinalizing({
  chatId,
  runId,
}: {
  chatId: string;
  runId?: string;
}): ExecutionRecord | null {
  const run = registry.activeRunsByChat.get(chatId);
  if (!run) {
    return null;
  }
  if (runId && run.runId !== runId) {
    return null;
  }

  if (
    isCancelRequested(chatId) ||
    !canTransitionState(run.executionState, "FINALIZING")
  ) {
    return run;
  }

  run.executionState = "FINALIZING";
  run.currentAction = "Verifying assertions and recording findings...";
  run.lastActivityAt = new Date().toISOString();
  run.sequence += 1;

  // Mark all steps completed
  for (const step of run.steps) {
    if (step.status === "running") {
      step.status = "completed";
    }
  }

  persistExecutionSnapshot(run);
  return run;
}

/**
 * Marks execution as COMPLETED. Terminal state.
 */
function completeRun({
  chatId,
  runId,
  verdict,
  findingId,
}: {
  chatId: string;
  runId?: string;
  verdict?: "pass" | "fail" | "uncertain" | "blocked";
  findingId?: string | null;
}): ExecutionRecord | null {
  const run = registry.activeRunsByChat.get(chatId);
  if (!run) {
    return null;
  }
  if (runId && run.runId !== runId) {
    return null;
  }

  // If run was already cancelled or cancelling, do not complete
  if (
    run.executionState === "CANCELLED" ||
    run.executionState === "CANCELLING" ||
    run.isCancelRequested ||
    !canTransitionState(run.executionState, "COMPLETED")
  ) {
    console.log(
      `[ExecutionTracker] completeRun blocked because run is in state ${run.executionState} (isCancelRequested=${run.isCancelRequested})`
    );
    return run;
  }

  run.executionState = "COMPLETED";
  run.verdict = verdict;
  run.findingId = findingId;
  run.completedAt = new Date().toISOString();
  run.lastActivityAt = run.completedAt;
  run.currentAction = "Test execution completed";
  run.sequence += 1;

  for (const step of run.steps) {
    if (step.status === "running") {
      step.status = "completed";
    }
  }

  persistExecutionSnapshot(run);
  return run;
}

/**
 * Marks execution as FAILED or TIMED_OUT. Terminal state.
 */
function failRun({
  chatId,
  runId,
  error,
  state = "FAILED",
}: {
  chatId: string;
  runId?: string;
  error: string;
  state?: "FAILED" | "TIMED_OUT";
}): ExecutionRecord | null {
  const run = registry.activeRunsByChat.get(chatId);
  if (!run) {
    return null;
  }
  if (runId && run.runId !== runId) {
    return null;
  }

  // Terminal irreversible states cannot be overwritten
  if (isIrreversibleExecutionState(run.executionState)) {
    return run;
  }

  run.executionState = state;
  run.error = error;
  run.completedAt = new Date().toISOString();
  run.lastActivityAt = run.completedAt;
  run.currentAction =
    state === "TIMED_OUT" ? "Execution timed out" : `Error: ${error}`;
  run.sequence += 1;

  if (run.steps.length > 0) {
    const last = run.steps.at(-1);
    for (const step of run.steps) {
      if (step === last) {
        if (step.status === "running") {
          step.status = "failed";
          step.error = error;
        }
      } else if (step.status === "running") {
        step.status = "completed";
      }
    }
  }

  persistExecutionSnapshot(run);
  return run;
}

/**
 * Idempotently initiates and processes cancellation/stopping of an active run.
 * Crucially stops the cloud task (client.tasks.stop) WITHOUT killing the browser session,
 * preserves all completed actions, last confirmed URL, and execution context.
 */
async function cancelRun({
  chatId,
  runId,
  reason = "user_stopped",
}: {
  chatId: string;
  runId?: string;
  reason?: string;
}): Promise<ExecutionRecord | null> {
  // 1. Immediately abort active stream/LLM execution so no further tool calls are initiated
  abortChat(chatId, reason);

  let run = registry.activeRunsByChat.get(chatId);
  if (!run) {
    try {
      const { getTestSessionByChatId } = await import("@/lib/db/queries");
      const dbSession = await getTestSessionByChatId({ chatId });
      if (dbSession?.executionSnapshot) {
        run = restoreRun(dbSession.executionSnapshot as any);
      } else if (dbSession) {
        run = startRun({
          browserSessionId: dbSession.browserSessionId ?? undefined,
          chatId,
          sessionId: dbSession.id,
          targetUrl: dbSession.targetUrl,
        });
      }
    } catch {
      /* non-fatal */
    }
  }

  if (!run) {
    return null;
  }
  if (runId && run.runId !== runId) {
    return null;
  }

  // Idempotency: If already in a terminal irreversible state, do not overwrite
  if (isIrreversibleExecutionState(run.executionState)) {
    return run;
  }

  // If already CANCELLED, return current record
  if (run.executionState === "CANCELLED") {
    return run;
  }

  const now = new Date().toISOString();
  run.isCancelRequested = true;
  run.executionState = "CANCELLING";
  run.cancellationReason = reason;
  run.interruptedAt = now;
  run.lastActivityAt = now;
  run.currentAction = "Stopping test execution...";
  run.sequence += 1;

  // Determine last confirmed action
  const lastStep = run.steps.at(-1) ?? null;
  run.lastConfirmedAction = lastStep ? lastStep.action : run.currentAction;

  // Persist CANCELLING state snapshot immediately so any concurrent reader/poller sees it
  await persistExecutionSnapshot(run);

  // Stop active Browser Use task immediately on cloud
  let client: ReturnType<typeof getBrowserUseClient> | null = null;
  try {
    client = getBrowserUseClient();
  } catch (err) {
    console.warn(
      "[ExecutionTracker] BrowserUse client not available for stop:",
      err
    );
  }

  if (client && run.activeTaskId) {
    try {
      await client.tasks.stop(run.activeTaskId);
      console.log(
        `[ExecutionTracker] Requested stop for active cloud task: ${run.activeTaskId}.`
      );
    } catch (err) {
      console.warn(
        `[ExecutionTracker] Failed to stop cloud task ${run.activeTaskId} (may have finished or stopped):`,
        err
      );
    }
  }

  // Also query session's task list to stop any in-flight or created task
  if (client && run.browserSessionId) {
    try {
      const taskList = await client.tasks
        .list({ sessionId: run.browserSessionId })
        .catch(() => null);
      const items = taskList?.items ?? (taskList as any)?.tasks ?? [];
      if (Array.isArray(items)) {
        for (const t of items) {
          if (t.status === "created" || t.status === "started") {
            console.log(
              `[ExecutionTracker] Stopping in-flight task ${t.id} on session ${run.browserSessionId}`
            );
            // biome-ignore lint/performance/noAwaitInLoops: sequential stop on in-flight tasks
            await client.tasks.stop(t.id).catch(() => null);
            if (!run.activeTaskId) {
              run.activeTaskId = t.id;
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        `[ExecutionTracker] Error querying session tasks for ${run.browserSessionId}:`,
        err
      );
    }
  }

  // Wait for cloud confirmation that task has halted
  if (client && run.activeTaskId) {
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential status check
      const st = await client.tasks.status(run.activeTaskId).catch(() => null);
      if (st && (st.status === "stopped" || st.status === "finished")) {
        console.log(
          `[ExecutionTracker] Cloud task ${run.activeTaskId} confirmed ${st.status}`
        );
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // Complete cancellation transition
  run.executionState = "CANCELLED";
  run.completedAt = new Date().toISOString();
  run.currentAction = "Test stopped by user";
  run.sequence += 1;

  // Mark all steps cleanly
  for (const step of run.steps) {
    if (step.status === "running") {
      step.status = "completed";
    }
  }

  await persistExecutionSnapshot(run);

  try {
    const { updateTestSessionStatus, getMessagesByChatId, saveMessages } =
      await import("@/lib/db/queries");
    if (run.sessionId) {
      await updateTestSessionStatus({ id: run.sessionId, status: "cancelled" });
    }

    // Persist a stopped assistant message if the last message in DB was user prompt
    const existingMessages = await getMessagesByChatId({
      id: run.chatId,
    }).catch(() => []);
    const lastMsg = existingMessages.at(-1);
    if (lastMsg && lastMsg.role === "user") {
      await saveMessages({
        messages: [
          {
            attachments: [],
            chatId: run.chatId,
            createdAt: new Date(),
            id: generateUUID(),
            parts: [
              ...(run.steps.length > 0
                ? [
                    {
                      input: {
                        instruction:
                          run.originalIntent ||
                          run.currentAction ||
                          "Execute browser task",
                      },
                      output: {
                        isStopped: true,
                        output: "Test execution was stopped by user.",
                        stepCount: run.steps.length,
                        success: false,
                      },
                      state: "output-available",
                      toolCallId: `stopped-step-${run.sequence}`,
                      type: "tool-runBrowserStep",
                    },
                  ]
                : [
                    {
                      text: "Test was stopped by user.",
                      type: "text",
                    },
                  ]),
            ],
            role: "assistant",
          },
        ],
      }).catch((err) => {
        console.warn("[ExecutionTracker] Could not save stopped message:", err);
      });
    }
  } catch {
    /* non-fatal */
  }

  return run;
}

/**
 * Resumes execution of a previously stopped or paused run.
 * Transitions state to RESUMING and preserves logical context.
 */
async function resumeRun({
  chatId,
  runId,
}: {
  chatId: string;
  runId?: string;
}): Promise<ExecutionRecord | null> {
  const run = registry.activeRunsByChat.get(chatId);
  if (!run) {
    return null;
  }
  if (runId && run.runId !== runId) {
    return null;
  }

  if (
    !isStoppedOrPausedState(run.executionState) &&
    run.executionState !== "RESUMING"
  ) {
    // Only stopped/paused runs can be resumed
    return run;
  }

  const now = new Date().toISOString();
  run.isCancelRequested = false;
  run.executionState = "RESUMING";
  run.currentAction = run.lastConfirmedAction
    ? `Resuming after: ${run.lastConfirmedAction}`
    : "Resuming test execution...";
  run.lastActivityAt = now;
  run.sequence += 1;

  await persistExecutionSnapshot(run);

  try {
    const { updateTestSessionStatus } = await import("@/lib/db/queries");
    if (run.sessionId) {
      await updateTestSessionStatus({
        force: true,
        id: run.sessionId,
        status: "active",
      });
    }
  } catch {
    /* non-fatal */
  }

  return run;
}

function getActiveRun(chatId: string): ExecutionRecord | null {
  return registry.activeRunsByChat.get(chatId) ?? null;
}

function getRunById(runId: string): ExecutionRecord | null {
  return registry.runsById.get(runId) ?? null;
}

/**
 * Adds or updates a download item on the active run.
 */
function addDownload(
  chatId: string,
  download: DownloadItem
): ExecutionRecord | null {
  const run =
    registry.activeRunsByChat.get(chatId) ||
    registry.runsById.get(download.runId);
  if (!run) {
    return null;
  }
  if (!run.downloads) {
    run.downloads = [];
  }
  const existingIdx = run.downloads.findIndex(
    (d) =>
      d.downloadId === download.downloadId || d.fileName === download.fileName
  );
  if (existingIdx >= 0) {
    run.downloads[existingIdx] = {
      ...run.downloads[existingIdx],
      ...download,
    };
  } else {
    run.downloads.push(download);
  }
  run.sequence += 1;
  run.lastActivityAt = new Date().toISOString();
  persistExecutionSnapshot(run).catch(() => {
    /* non-fatal snapshot update */
  });
  return run;
}

/**
 * Updates a download item on the active run.
 */
function updateDownload(
  chatId: string,
  downloadId: string,
  updates: Partial<DownloadItem>
): ExecutionRecord | null {
  const run =
    registry.activeRunsByChat.get(chatId) ||
    (updates.runId ? registry.runsById.get(updates.runId) : null);
  if (!run?.downloads) {
    return null;
  }
  const idx = run.downloads.findIndex((d) => d.downloadId === downloadId);
  if (idx >= 0) {
    run.downloads[idx] = {
      ...run.downloads[idx],
      ...updates,
    };
    run.sequence += 1;
    run.lastActivityAt = new Date().toISOString();
    persistExecutionSnapshot(run).catch(() => {
      /* non-fatal snapshot update */
    });
  }
  return run;
}

function getDownloads(runId: string): DownloadItem[] {
  const run = registry.runsById.get(runId);
  return run?.downloads || [];
}

/**
 * Persists an assistant message if the last message in DB is from user.
 * Ensures that completed background runs appear in chat history on page reload.
 */
async function maybePersistAssistantMessage(
  run: ExecutionRecord
): Promise<void> {
  try {
    const { getMessagesByChatId, saveMessages } = await import(
      "@/lib/db/queries"
    );
    const existingMessages = await getMessagesByChatId({
      id: run.chatId,
    }).catch(() => []);
    const lastMsg = existingMessages.at(-1);
    if (lastMsg && lastMsg.role === "user") {
      const isComplete = run.executionState === "COMPLETED";
      const isStopped = run.executionState === "CANCELLED";

      const stepParts =
        run.steps.length > 0
          ? [
              {
                input: {
                  instruction:
                    run.originalIntent ||
                    run.currentAction ||
                    "Execute browser task",
                },
                output: {
                  isStopped,
                  lastConfirmedAction:
                    run.lastConfirmedAction || run.currentAction,
                  output: isStopped
                    ? "Test execution was stopped by user."
                    : run.currentAction ||
                      "Test execution completed successfully.",
                  stepCount: run.steps.length,
                  success: isComplete,
                },
                state: "output-available",
                toolCallId: `step-${run.sequence || 1}`,
                type: "tool-runBrowserStep",
              },
            ]
          : [];

      const evalPart = isComplete
        ? [
            {
              input: {},
              output: {
                actual: run.currentAction || "Test completed successfully.",
                expected: "Test completed",
                findingId: run.findingId || null,
                status: run.verdict || "pass",
                summary: run.currentAction || "Test execution completed.",
                title:
                  run.verdict === "pass" ? "Test Passed" : "Test Completed",
              },
              state: "output-available",
              toolCallId: `eval-${run.sessionId || generateUUID()}`,
              type: "tool-evaluateTestResult",
            },
          ]
        : [];

      await saveMessages({
        messages: [
          {
            attachments: [],
            chatId: run.chatId,
            createdAt: new Date(),
            id: generateUUID(),
            parts: [
              {
                input: { targetUrl: run.targetUrl },
                output: {
                  browserSessionId: run.browserSessionId,
                  sessionId: run.sessionId,
                  targetUrl: run.targetUrl,
                },
                state: "output-available",
                toolCallId: `start-${run.sessionId || "session"}`,
                type: "tool-startTestSession",
              },
              ...stepParts,
              ...evalPart,
              {
                text: isStopped
                  ? "Test was stopped by user."
                  : "Test completed successfully.",
                type: "text",
              },
            ],
            role: "assistant",
          },
        ],
      }).catch((err) => {
        console.warn(
          "[ExecutionTracker] Could not save completed message:",
          err
        );
      });
    }
  } catch (err) {
    console.warn("[ExecutionTracker] maybePersistAssistantMessage error:", err);
  }
}

/**
 * Authoritatively reconciles the execution state against Browser Use Cloud,
 * DB snapshot, and actual task status.
 * Eliminates ghost runs, ensures completed cloud tasks are never treated as running.
 */
async function reconcileRun(chatId: string): Promise<ExecutionRecord | null> {
  let run = registry.activeRunsByChat.get(chatId);

  if (!run) {
    try {
      const { getTestSessionByChatId } = await import("@/lib/db/queries");
      const dbSession = await getTestSessionByChatId({ chatId });
      if (dbSession?.executionSnapshot) {
        run = restoreRun(dbSession.executionSnapshot as any);
      }
    } catch {
      /* non-fatal */
    }
  }

  if (!run) {
    return null;
  }

  // If already terminal, ensure all steps are resolved and return
  if (isIrreversibleExecutionState(run.executionState)) {
    let changed = false;
    for (const step of run.steps) {
      if (step.status === "running") {
        step.status = "completed";
        changed = true;
      }
    }
    if (changed) {
      persistExecutionSnapshot(run).catch(() => {
        /* non-fatal snapshot update */
      });
    }
    return run;
  }

  // For non-terminal runs, verify with actual Browser Use Cloud status
  let client: ReturnType<typeof getBrowserUseClient> | null = null;
  try {
    client = getBrowserUseClient();
  } catch {
    /* non-fatal */
  }

  if (client) {
    // 1. Check if the underlying browser session is still active
    if (run.browserSessionId) {
      try {
        const cloudSession = await client.sessions
          .get(run.browserSessionId)
          .catch(() => null);

        const isSessionDead =
          cloudSession?.status !== "active" ||
          Boolean(cloudSession?.finishedAt);

        if (isSessionDead) {
          console.log(
            `[ExecutionTracker] Reconciling: cloud session ${run.browserSessionId} is dead. Marking execution COMPLETED.`
          );
          for (const s of run.steps) {
            if (s.status === "running") {
              s.status = "completed";
            }
          }
          run.executionState =
            run.isCancelRequested || run.executionState === "CANCELLING"
              ? "CANCELLED"
              : "COMPLETED";
          run.completedAt =
            cloudSession?.finishedAt || new Date().toISOString();
          run.lastActivityAt = run.completedAt;
          run.currentAction =
            run.executionState === "CANCELLED"
              ? "Test stopped by user"
              : "Test execution completed";
          run.sequence += 1;

          await persistExecutionSnapshot(run);

          if (run.sessionId) {
            const { updateTestSessionStatus } = await import(
              "@/lib/db/queries"
            );
            await updateTestSessionStatus({
              force: true,
              id: run.sessionId,
              status:
                run.executionState === "CANCELLED" ? "cancelled" : "completed",
            }).catch(() => null);
          }

          await maybePersistAssistantMessage(run);
          return run;
        }
      } catch (err) {
        console.warn(
          `[ExecutionTracker] Error querying cloud session ${run.browserSessionId}:`,
          err
        );
      }
    }

    // 2. Check active task or query latest task on session
    let targetTaskId = run.activeTaskId;
    if (!targetTaskId && run.browserSessionId) {
      try {
        const taskList = await client.tasks
          .list({ sessionId: run.browserSessionId })
          .catch(() => null);
        const items = taskList?.items ?? (taskList as any)?.tasks ?? [];
        if (Array.isArray(items) && items.length > 0) {
          const sorted = [...items].sort(
            (a: any, b: any) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          targetTaskId = sorted[0]?.id;
          if (targetTaskId) {
            run.activeTaskId = targetTaskId;
          }
        }
      } catch (err) {
        console.warn(
          "[ExecutionTracker] Error listing session tasks for reconcile:",
          err
        );
      }
    }

    if (targetTaskId) {
      try {
        const task = await client.tasks.get(targetTaskId).catch(() => null);
        if (task) {
          if (task.status === "finished") {
            console.log(
              `[ExecutionTracker] Reconciling: cloud task ${targetTaskId} is finished. Updating state to COMPLETED.`
            );
            if (
              task.steps &&
              Array.isArray(task.steps) &&
              task.steps.length > 0
            ) {
              run.steps = task.steps.map((st: any, idx: number) => ({
                action:
                  (typeof st.nextGoal === "string" && st.nextGoal.trim()) ||
                  (typeof st.evaluationPreviousGoal === "string" &&
                    st.evaluationPreviousGoal.trim()) ||
                  (typeof st.output === "string" && st.output.trim()) ||
                  `Step ${idx + 1}`,
                number: idx + 1,
                status: "completed" as const,
                timestamp: st.createdAt || run.lastActivityAt,
                url: st.url ?? st.currentUrl ?? undefined,
              }));
              run.currentStep = run.steps.length;
            } else {
              for (const s of run.steps) {
                if (s.status === "running") {
                  s.status = "completed";
                }
              }
            }

            run.executionState = "COMPLETED";
            run.completedAt = task.finishedAt || new Date().toISOString();
            run.lastActivityAt = run.completedAt;
            run.currentAction =
              typeof task.output === "string" && task.output.trim()
                ? "Test execution completed"
                : "Test completed";
            run.sequence += 1;

            await persistExecutionSnapshot(run);

            if (run.sessionId) {
              const { updateTestSessionStatus } = await import(
                "@/lib/db/queries"
              );
              await updateTestSessionStatus({
                force: true,
                id: run.sessionId,
                status: "completed",
              }).catch(() => null);
            }

            await maybePersistAssistantMessage(run);
            return run;
          }

          if (task.status === "stopped") {
            console.log(
              `[ExecutionTracker] Reconciling: cloud task ${targetTaskId} is stopped. Updating state to CANCELLED.`
            );
            for (const s of run.steps) {
              if (s.status === "running") {
                s.status = "completed";
              }
            }
            run.executionState = "CANCELLED";
            run.completedAt = task.finishedAt || new Date().toISOString();
            run.lastActivityAt = run.completedAt;
            run.currentAction = "Test stopped by user";
            run.sequence += 1;

            await persistExecutionSnapshot(run);

            if (run.sessionId) {
              const { updateTestSessionStatus } = await import(
                "@/lib/db/queries"
              );
              await updateTestSessionStatus({
                force: true,
                id: run.sessionId,
                status: "cancelled",
              }).catch(() => null);
            }

            await maybePersistAssistantMessage(run);
            return run;
          }

          if (task.status === "failed") {
            console.log(
              `[ExecutionTracker] Reconciling: cloud task ${targetTaskId} is failed. Updating state to FAILED.`
            );
            if (run.steps.length > 0) {
              const last = run.steps.at(-1);
              if (last && last.status === "running") {
                last.status = "failed";
              }
            }
            run.executionState = "FAILED";
            run.completedAt = task.finishedAt || new Date().toISOString();
            run.lastActivityAt = run.completedAt;
            run.currentAction = "Test execution failed";
            run.sequence += 1;

            await persistExecutionSnapshot(run);

            if (run.sessionId) {
              const { updateTestSessionStatus } = await import(
                "@/lib/db/queries"
              );
              await updateTestSessionStatus({
                force: true,
                id: run.sessionId,
                status: "error",
              }).catch(() => null);
            }
            return run;
          }

          if (task.status === "started" || task.status === "created") {
            // Task is actually in flight on the cloud!
            if (
              task.steps &&
              Array.isArray(task.steps) &&
              task.steps.length > 0
            ) {
              run.steps = task.steps.map((st: any, idx: number) => ({
                action:
                  (typeof st.nextGoal === "string" && st.nextGoal.trim()) ||
                  (typeof st.evaluationPreviousGoal === "string" &&
                    st.evaluationPreviousGoal.trim()) ||
                  (typeof st.output === "string" && st.output.trim()) ||
                  `Step ${idx + 1}`,
                number: idx + 1,
                status: (idx === task.steps.length - 1
                  ? "running"
                  : "completed") as "running" | "completed",
                timestamp: st.createdAt || run.lastActivityAt,
                url: st.url ?? st.currentUrl ?? undefined,
              }));
              run.currentStep = run.steps.length;
              const lastGoal = task.steps.at(-1)?.nextGoal;
              if (lastGoal && typeof lastGoal === "string") {
                run.currentAction = lastGoal;
              }
            }
            run.executionState = "RUNNING";
            run.lastActivityAt = new Date().toISOString();
            await persistExecutionSnapshot(run);
            return run;
          }
        }
      } catch (err) {
        console.warn(
          `[ExecutionTracker] Error getting task ${targetTaskId}:`,
          err
        );
      }
    }
  }

  // 3. Stale activity check: if a non-terminal run has had no activity for > 2 minutes
  // and no task is in-flight on cloud, it must not remain active
  const elapsedSinceActivity =
    Date.now() - new Date(run.lastActivityAt || run.startedAt).getTime();
  if (elapsedSinceActivity > 120_000) {
    console.log(
      `[ExecutionTracker] Run for chat ${chatId} has been inactive for ${Math.round(elapsedSinceActivity / 1000)}s. Marking COMPLETED.`
    );
    for (const s of run.steps) {
      if (s.status === "running") {
        s.status = "completed";
      }
    }
    run.executionState = "COMPLETED";
    run.completedAt = new Date().toISOString();
    run.lastActivityAt = run.completedAt;
    run.currentAction = "Test execution completed";
    run.sequence += 1;

    await persistExecutionSnapshot(run);

    if (run.sessionId) {
      const { updateTestSessionStatus } = await import("@/lib/db/queries");
      await updateTestSessionStatus({
        force: true,
        id: run.sessionId,
        status: "completed",
      }).catch(() => null);
    }

    await maybePersistAssistantMessage(run);
  }

  return run;
}

/**
 * Restores an execution record into memory (e.g. on server reload or reconnection).
 */
function restoreRun(record: ExecutionRecord): ExecutionRecord {
  if (!record.downloads) {
    record.downloads = [];
  }
  registry.activeRunsByChat.set(record.chatId, record);
  registry.runsById.set(record.runId, record);
  return record;
}

export const ExecutionTracker = {
  abortChat,
  addDownload,
  cancelRun,
  completeRun,
  failRun,
  getActiveRun,
  getDownloads,
  getRunById,
  isCancelRequested,
  reconcileRun,
  recordFinalizing,
  recordWaiting,
  registerAbortController,
  restoreRun,
  resumeRun,
  setActiveTaskId,
  startRun,
  unregisterAbortController,
  updateDownload,
  updateStep,
};
