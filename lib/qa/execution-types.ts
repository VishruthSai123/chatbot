export type CanonicalExecutionState =
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "WAITING"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export const TERMINAL_EXECUTION_STATES = new Set<CanonicalExecutionState>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);

export function isTerminalExecutionState(
  state: CanonicalExecutionState | string | undefined
): boolean {
  if (!state) {
    return false;
  }
  return TERMINAL_EXECUTION_STATES.has(state as CanonicalExecutionState);
}

/**
 * State Transition Matrix:
 * Prevents regressions (e.g. late RUNNING event reverting a COMPLETED/FAILED run).
 */
export function canTransitionState(
  currentState: CanonicalExecutionState,
  nextState: CanonicalExecutionState
): boolean {
  // Terminal states are irreversible
  if (isTerminalExecutionState(currentState)) {
    return false;
  }

  // Once FINALIZING, can only transition to terminal states
  if (currentState === "FINALIZING") {
    return isTerminalExecutionState(nextState);
  }

  return true;
}

export interface ExecutionStep {
  action: string;
  durationMs?: number;
  error?: string;
  number: number;
  status: "running" | "completed" | "failed";
  timestamp: string;
  url?: string;
}

export interface ExecutionRecord {
  activeTaskId?: string | null;
  browserSessionId?: string; // Browser Use Cloud Session ID
  chatId: string;
  completedAt?: string;
  currentAction?: string;
  currentStep?: number;
  error?: string;
  executionState: CanonicalExecutionState;
  findingId?: string | null;
  lastActivityAt: string;
  runId: string;
  sequence: number;
  sessionId: string; // Database TestSession ID
  startedAt: string;
  steps: ExecutionStep[];
  targetUrl: string;
  verdict?: "pass" | "fail" | "uncertain" | "blocked";
}

export interface QAExecutionStreamData {
  browserSessionId?: string;
  completedAt?: string;
  currentAction?: string;
  currentStep?: number;
  error?: string;
  executionState: CanonicalExecutionState;
  findingId?: string | null;
  lastActivityAt: string;
  runId: string;
  sequence: number;
  sessionId: string;
  startedAt: string;
  steps?: ExecutionStep[];
  verdict?: "pass" | "fail" | "uncertain" | "blocked";
}

export function getStateDescription(
  state: CanonicalExecutionState,
  currentAction?: string
): string {
  switch (state) {
    case "QUEUED":
      return "Queuing test execution...";
    case "STARTING":
      return currentAction || "Connecting to live browser session...";
    case "RUNNING":
      return currentAction || "Executing browser actions...";
    case "WAITING":
      return (
        currentAction || "Analyzing browser outcome and verifying state..."
      );
    case "FINALIZING":
      return "Recording test findings and assertions...";
    case "COMPLETED":
      return "Test completed successfully.";
    case "FAILED":
      return currentAction || "Test execution failed.";
    case "CANCELLED":
      return "Test was stopped by user.";
    case "TIMED_OUT":
      return "Test timed out before completion.";
    default:
      return "Ready";
  }
}
