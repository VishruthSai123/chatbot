import { getBrowserUseClient } from "@/lib/browser-use/client";
import { generateUUID } from "@/lib/utils";
import {
  canTransitionState,
  type ExecutionRecord,
  type ExecutionStep,
  isTerminalExecutionState,
} from "./execution-types";

interface GlobalQARunRegistry {
  activeRunsByChat: Map<string, ExecutionRecord>;
  runsById: Map<string, ExecutionRecord>;
}

const globalForQA = globalThis as unknown as {
  __qaRegistry?: GlobalQARunRegistry;
};

if (!globalForQA.__qaRegistry) {
  globalForQA.__qaRegistry = {
    activeRunsByChat: new Map(),
    runsById: new Map(),
  };
}

const registry = globalForQA.__qaRegistry;

/**
 * Initializes or re-anchors an authoritative run for a chat.
 */
function startRun({
  chatId,
  targetUrl,
  sessionId,
  browserSessionId,
  runId,
}: {
  chatId: string;
  targetUrl: string;
  sessionId: string;
  browserSessionId?: string;
  runId?: string;
}): ExecutionRecord {
  const existing = registry.activeRunsByChat.get(chatId);
  if (
    existing &&
    !isTerminalExecutionState(existing.executionState) &&
    existing.sessionId === sessionId
  ) {
    existing.lastActivityAt = new Date().toISOString();
    if (browserSessionId && !existing.browserSessionId) {
      existing.browserSessionId = browserSessionId;
    }
    return existing;
  }

  const newRunId = runId || generateUUID();
  const now = new Date().toISOString();

  const record: ExecutionRecord = {
    activeTaskId: null,
    browserSessionId,
    chatId,
    currentAction: "Initializing browser session...",
    executionState: "STARTING",
    lastActivityAt: now,
    runId: newRunId,
    sequence: 1,
    sessionId,
    startedAt: now,
    steps: [],
    targetUrl,
  };

  registry.activeRunsByChat.set(chatId, record);
  registry.runsById.set(newRunId, record);

  return record;
}

function setActiveTaskId(chatId: string, runId: string, taskId: string) {
  const run = registry.activeRunsByChat.get(chatId);
  if (run && run.runId === runId) {
    run.activeTaskId = taskId;
    run.lastActivityAt = new Date().toISOString();
  }
}

/**
 * Records step progress from Browser Use SDK.
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

  if (!canTransitionState(run.executionState, "RUNNING")) {
    return run;
  }

  run.executionState = "RUNNING";
  run.currentStep = number;
  run.currentAction = action;
  run.lastActivityAt = new Date().toISOString();
  run.sequence += 1;

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

  return run;
}

/**
 * Transitions execution to WAITING (e.g. Browser Use completed physical step, awaiting LLM assessment).
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

  if (!canTransitionState(run.executionState, "WAITING")) {
    return run;
  }

  run.executionState = "WAITING";
  if (currentAction) {
    run.currentAction = currentAction;
  }
  run.lastActivityAt = new Date().toISOString();
  run.sequence += 1;

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

  if (!canTransitionState(run.executionState, "FINALIZING")) {
    return run;
  }

  run.executionState = "FINALIZING";
  run.currentAction = "Verifying assertions and recording findings...";
  run.lastActivityAt = new Date().toISOString();
  run.sequence += 1;

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

  run.executionState = "COMPLETED";
  run.verdict = verdict;
  run.findingId = findingId;
  run.completedAt = new Date().toISOString();
  run.lastActivityAt = run.completedAt;
  run.currentAction = "Test execution completed";
  run.sequence += 1;

  // Mark any trailing running step as completed
  for (const step of run.steps) {
    if (step.status === "running") {
      step.status = "completed";
    }
  }

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

  run.executionState = state;
  run.error = error;
  run.completedAt = new Date().toISOString();
  run.lastActivityAt = run.completedAt;
  run.currentAction =
    state === "TIMED_OUT" ? "Execution timed out" : `Error: ${error}`;
  run.sequence += 1;

  // Mark current step as failed
  if (run.steps.length > 0) {
    const last = run.steps.at(-1);
    if (last && last.status === "running") {
      last.status = "failed";
      last.error = error;
    }
  }

  return run;
}

/**
 * Gracefully cancels an active run and stops any running cloud task.
 */
async function cancelRun({
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

  run.executionState = "CANCELLED";
  run.completedAt = new Date().toISOString();
  run.lastActivityAt = run.completedAt;
  run.currentAction = "Cancelled by user";
  run.sequence += 1;

  // Attempt to stop active task on Browser Use Cloud
  if (run.activeTaskId) {
    try {
      const client = getBrowserUseClient();
      await client.tasks.stop(run.activeTaskId);
    } catch (err) {
      console.warn(
        `[ExecutionTracker] Failed to stop cloud task ${run.activeTaskId}:`,
        err
      );
    }
  }

  return run;
}

function getActiveRun(chatId: string): ExecutionRecord | null {
  return registry.activeRunsByChat.get(chatId) ?? null;
}

function getRunById(runId: string): ExecutionRecord | null {
  return registry.runsById.get(runId) ?? null;
}

export const ExecutionTracker = {
  cancelRun,
  completeRun,
  failRun,
  getActiveRun,
  getRunById,
  recordFinalizing,
  recordWaiting,
  setActiveTaskId,
  startRun,
  updateStep,
};
