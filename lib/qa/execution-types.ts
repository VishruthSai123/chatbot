export type CanonicalExecutionState =
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "WAITING"
  | "WAITING_FOR_USER"
  | "PAUSING"
  | "PAUSED"
  | "CANCELLING"
  | "CANCELLED"
  | "RESUMING"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "TIMED_OUT";

export const IRREVERSIBLE_EXECUTION_STATES = new Set<CanonicalExecutionState>([
  "COMPLETED",
  "FAILED",
  "TIMED_OUT",
]);

export function isIrreversibleExecutionState(
  state: CanonicalExecutionState | string | undefined
): boolean {
  if (!state) {
    return false;
  }
  return IRREVERSIBLE_EXECUTION_STATES.has(state as CanonicalExecutionState);
}

export function isTerminalExecutionState(
  state: CanonicalExecutionState | string | undefined
): boolean {
  if (!state) {
    return false;
  }
  // Irreversible terminal states
  return (
    state === "COMPLETED" ||
    state === "FAILED" ||
    state === "TIMED_OUT" ||
    state === "CANCELLED"
  );
}

export function isStoppedOrPausedState(
  state: CanonicalExecutionState | string | undefined
): boolean {
  return state === "CANCELLED" || state === "PAUSED";
}

export function isWaitingForUserState(
  state: CanonicalExecutionState | string | undefined
): boolean {
  return state === "WAITING_FOR_USER";
}

/**
 * State Transition Matrix:
 * Prevents regressions (e.g. late RUNNING event reverting a COMPLETED/CANCELLED run).
 * Supports safe cancellation, pausing, and resuming.
 */
export function canTransitionState(
  currentState: CanonicalExecutionState,
  nextState: CanonicalExecutionState
): boolean {
  // Completely irreversible terminal states
  if (isIrreversibleExecutionState(currentState)) {
    return false;
  }

  // Once CANCELLING, can only transition to CANCELLED or FAILED
  if (currentState === "CANCELLING") {
    return nextState === "CANCELLED" || nextState === "FAILED";
  }

  // Once PAUSING, can only transition to PAUSED, CANCELLED, or FAILED
  if (currentState === "PAUSING") {
    return (
      nextState === "PAUSED" ||
      nextState === "CANCELLED" ||
      nextState === "FAILED"
    );
  }

  // WAITING_FOR_USER: can transition to RESUMING/RUNNING (answer received),
  // CANCELLING/CANCELLED (user stops), or FAILED
  if (currentState === "WAITING_FOR_USER") {
    return (
      nextState === "RESUMING" ||
      nextState === "RUNNING" ||
      nextState === "CANCELLING" ||
      nextState === "CANCELLED" ||
      nextState === "FAILED"
    );
  }

  // If CANCELLED or PAUSED, can only transition if resuming or starting a new run
  if (isStoppedOrPausedState(currentState)) {
    return (
      nextState === "RESUMING" ||
      nextState === "STARTING" ||
      nextState === "CANCELLED"
    );
  }

  // Once FINALIZING, can only transition to terminal states or CANCELLED
  if (currentState === "FINALIZING") {
    return isTerminalExecutionState(nextState) || nextState === "CANCELLED";
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

export type DownloadStatus = "started" | "downloading" | "ready" | "failed";

export interface DownloadItem {
  createdAt: string;
  downloadId: string;
  error?: string;
  fileName: string;
  fileSize?: number;
  localPath?: string;
  mimeType: string;
  remoteUrl?: string;
  runId: string;
  status: DownloadStatus;
  url?: string;
}

/**
 * The type of clarification the agent is requesting from the user.
 * - "choice": Pick from a list of options
 * - "text": Free-form text input
 * - "number": Numeric input
 * - "confirm" / "confirmation": Confirmation action (e.g. Yes/No, Continue/Cancel)
 */
export type ClarificationQuestionType =
  | "choice"
  | "text"
  | "number"
  | "confirm"
  | "confirmation"
  | (string & {});

/**
 * Represents a structured question the agent asks the user mid-execution.
 */
export interface ClarificationQuestion {
  /** Context about what the agent was doing when it asked */
  agentContext?: string;
  /** The user's answer once provided */
  answer?: string;
  /** When the question was answered */
  answeredAt?: string;
  /** When the question was asked */
  askedAt: string;
  /** Alias for questionType */
  inputType?: ClarificationQuestionType;
  /** Whether the question has been answered */
  isAnswered: boolean;
  /** Options for "choice" or "confirm" type questions */
  options?: string[];
  /** Optional placeholder for text or numeric input */
  placeholder?: string;
  /** Alias for questionText */
  question?: string;
  /** Unique identifier for this question */
  questionId: string;
  /** The question text shown to the user */
  questionText: string;
  /** The type of input requested */
  questionType: ClarificationQuestionType;
  /** Whether user response is required to proceed */
  required?: boolean;
  /** Active run identifier */
  runId?: string;
  /** Structured question discriminator */
  type?: "USER_INPUT_REQUIRED";
}

export interface ExecutionRecord {
  activeTaskId?: string | null;
  browserSessionId?: string; // Browser Use Cloud Session ID
  cancellationReason?: string;
  chatId: string;
  /** History of all clarification Q&As in this run */
  clarificationHistory?: ClarificationQuestion[];
  completedAt?: string;
  currentAction?: string;
  currentStep?: number;
  downloads?: DownloadItem[];
  error?: string;
  executionState: CanonicalExecutionState;
  findingId?: string | null;
  interruptedAt?: string;
  isCancelRequested?: boolean;
  lastActivityAt: string;
  lastConfirmedAction?: string;
  originalIntent?: string;
  /** Active clarification question awaiting user response */
  pendingQuestion?: ClarificationQuestion | null;
  remainingGoals?: string[];
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
  cancellationReason?: string;
  completedAt?: string;
  currentAction?: string;
  currentStep?: number;
  downloads?: DownloadItem[];
  error?: string;
  executionState: CanonicalExecutionState;
  findingId?: string | null;
  interruptedAt?: string;
  lastActivityAt: string;
  lastConfirmedAction?: string;
  pendingQuestion?: ClarificationQuestion | null;
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
    case "WAITING_FOR_USER":
      return currentAction || "Waiting for your input to continue...";
    case "PAUSING":
      return "Pausing test execution...";
    case "PAUSED":
      return "Test paused. Say 'Continue' to resume.";
    case "CANCELLING":
      return "Stopping browser execution safely...";
    case "CANCELLED":
      return "Test stopped. Say 'Continue' to resume from where you left off.";
    case "RESUMING":
      return (
        currentAction || "Resuming test execution from last confirmed step..."
      );
    case "FINALIZING":
      return "Recording test findings and assertions...";
    case "COMPLETED":
      return "Test completed successfully.";
    case "FAILED":
      return currentAction || "Test execution failed.";
    case "TIMED_OUT":
      return "Test timed out before completion.";
    default:
      return "Ready";
  }
}
