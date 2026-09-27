"use client";

import {
  CheckCircle2,
  ChevronDownIcon,
  CircleAlert,
  CircleStop,
  Clock,
  Globe,
  Keyboard,
  MousePointer2,
  Search,
  Sparkles,
  Square,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useArtifact } from "@/hooks/use-artifact";
import { isTerminalExecutionState } from "@/lib/qa/execution-types";
import { cn } from "@/lib/utils";
import { Shimmer } from "../ai-elements/shimmer";
import { AgentDownloads } from "./agent-downloads";

export interface AgentProcessingProps {
  chatId?: string;
  className?: string;
  isLoading?: boolean;
  messageId: string;
  onStop?: () => void;
  parts: any[];
}

export type AgentActionType =
  | "navigate"
  | "click"
  | "input"
  | "search"
  | "verify"
  | "wait"
  | "stop"
  | "default";

interface ActionItem {
  actionType: AgentActionType;
  detail?: string;
  error?: string;
  id: string;
  label: string;
  status: "completed" | "failed" | "pending" | "running";
}

function getActionType(label: string, detail?: string): AgentActionType {
  const text = `${label} ${detail || ""}`.toLowerCase();
  if (
    text.includes("navigate") ||
    text.includes("connect") ||
    text.includes("open") ||
    text.includes("goto") ||
    text.includes("http://") ||
    text.includes("https://")
  ) {
    return "navigate";
  }
  if (
    text.includes("search") ||
    text.includes("find") ||
    text.includes("query") ||
    text.includes("looking for")
  ) {
    return "search";
  }
  if (
    text.includes("click") ||
    text.includes("press") ||
    text.includes("select") ||
    text.includes("tap") ||
    text.includes("choose") ||
    text.includes("submit") ||
    text.includes("button")
  ) {
    return "click";
  }
  if (
    text.includes("type") ||
    text.includes("input") ||
    text.includes("enter") ||
    text.includes("fill") ||
    text.includes("write") ||
    text.includes("keystroke")
  ) {
    return "input";
  }
  if (
    text.includes("verify") ||
    text.includes("check") ||
    text.includes("assert") ||
    text.includes("eval") ||
    text.includes("finding") ||
    text.includes("outcome") ||
    text.includes("confirm")
  ) {
    return "verify";
  }
  if (
    text.includes("wait") ||
    text.includes("sleep") ||
    text.includes("delay") ||
    text.includes("pause")
  ) {
    return "wait";
  }
  if (text.includes("stop") || text.includes("cancel")) {
    return "stop";
  }
  return "default";
}

function getActionTypeIcon(actionType: AgentActionType) {
  switch (actionType) {
    case "navigate":
      return Globe;
    case "click":
      return MousePointer2;
    case "input":
      return Keyboard;
    case "search":
      return Search;
    case "verify":
      return CheckCircle2;
    case "wait":
      return Clock;
    case "stop":
      return CircleStop;
    default:
      return Sparkles;
  }
}

function renderStepIcon(action: ActionItem) {
  if (action.status === "failed") {
    return <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />;
  }

  const IconComp = getActionTypeIcon(action.actionType);

  if (action.status === "running") {
    return (
      <IconComp className="mt-0.5 size-4 shrink-0 animate-pulse text-foreground/90" />
    );
  }

  return (
    <IconComp
      className={cn(
        "mt-0.5 size-4 shrink-0 transition-colors",
        action.status === "completed"
          ? "text-muted-foreground/75 group-hover/row:text-foreground"
          : "text-muted-foreground/40"
      )}
    />
  );
}

function formatTargetDomain(urlStr?: string): { domain: string; full: string } {
  if (!urlStr) {
    return { domain: "browser session", full: "" };
  }
  try {
    const parsed = new URL(
      urlStr.startsWith("http") ? urlStr : `https://${urlStr}`
    );
    const domain = parsed.hostname.replace(/^www\./, "");
    return { domain, full: parsed.href };
  } catch {
    return { domain: urlStr, full: urlStr };
  }
}

function SparkleMiniIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height="12"
      viewBox="0 0 16 16"
      width="12"
    >
      <path d="M8 0C8 4.41828 4.41828 8 0 8C4.41828 8 8 11.5817 8 16C8 11.5817 11.5817 8 16 8C11.5817 8 8 4.41828 8 0Z" />
    </svg>
  );
}

export const AgentProcessing = memo(
  ({
    chatId,
    className,
    isLoading = false,
    messageId: _messageId,
    onStop,
    parts,
  }: AgentProcessingProps) => {
    const { metadata } = useArtifact();
    const [isOpen, setIsOpen] = useState(true);
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
    const [persistedDuration, setPersistedDuration] = useState<number | null>(
      null
    );
    const startTimeRef = useRef<number | null>(null);
    const pauseStartRef = useRef<number | null>(null);
    const totalPausedMsRef = useRef<number>(0);

    const handleStop = useCallback(
      async (e?: React.MouseEvent) => {
        e?.preventDefault();
        e?.stopPropagation();
        if (onStop) {
          onStop();
          return;
        }
        if (!chatId) {
          return;
        }

        window.dispatchEvent(
          new CustomEvent("qa:cancelling-requested", {
            detail: { chatId },
          })
        );

        try {
          await fetch("/api/qa/session", {
            body: JSON.stringify({ action: "stop", chatId }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
        } catch (err) {
          console.warn("[AgentProcessing] Error stopping session:", err);
        }

        window.dispatchEvent(
          new CustomEvent("qa:stop-requested", {
            detail: { chatId },
          })
        );
      },
      [chatId, onStop]
    );

    // Identify tool parts from the message
    const startTestSessionPart = parts.find(
      (p) => p.type === "tool-startTestSession"
    );
    const runBrowserStepParts = parts.filter(
      (p) => p.type === "tool-runBrowserStep"
    );
    const evaluateTestResultPart = parts.find(
      (p) => p.type === "tool-evaluateTestResult"
    );

    // State detection
    const isStartRunning =
      startTestSessionPart &&
      (startTestSessionPart.state === "input-available" ||
        startTestSessionPart.state === "input-streaming");

    const isRunStepRunning = runBrowserStepParts.some(
      (p) => p.state === "input-available" || p.state === "input-streaming"
    );

    const isEvalRunning =
      evaluateTestResultPart &&
      (evaluateTestResultPart.state === "input-available" ||
        evaluateTestResultPart.state === "input-streaming");

    const errorPart = parts.find(
      (p) =>
        p.state === "output-error" ||
        (p.output &&
          typeof p.output === "object" &&
          "error" in (p.output as Record<string, unknown>))
    );

    // Distinguish this message's historical state from the global metadata state
    const isThisMessageStopped = parts.some(
      (p) =>
        Boolean(p.output?.isStopped) ||
        p.output?.output === "Test execution was stopped by user."
    );

    // Check if this message's evaluation has completed
    const isEvalCompleted = Boolean(
      evaluateTestResultPart &&
        (evaluateTestResultPart.state === "output-available" ||
          evaluateTestResultPart.state === "output-error")
    );

    // Check if all tool parts in this message have resolved
    const areAllMessageToolsResolved =
      parts.length > 0 &&
      parts.every(
        (p) =>
          p.state === "output-available" ||
          p.state === "output-error" ||
          p.state === "output-denied"
      );

    const hasAnyActiveTool = Boolean(
      isStartRunning || isRunStepRunning || isEvalRunning
    );

    // Terminal completion resolution:
    // If evaluation completed, or stream finished with all tools resolved and no active tool
    const isMessageFinished =
      isEvalCompleted ||
      (!isLoading && areAllMessageToolsResolved && !hasAnyActiveTool);

    // If this message was stopped, its state is frozen at CANCELLED and never affected by future runs
    const execState = isThisMessageStopped
      ? "CANCELLED"
      : isMessageFinished
        ? errorPart
          ? "FAILED"
          : metadata?.executionState === "CANCELLED"
            ? "CANCELLED"
            : "COMPLETED"
        : metadata?.executionState;

    const isCanonicalTerminal = isTerminalExecutionState(execState);
    const isMetadataTerminal =
      metadata?.status === "completed" ||
      metadata?.status === "stopped" ||
      metadata?.status === "failed" ||
      metadata?.status === "error";

    const isTerminal =
      isCanonicalTerminal ||
      isMetadataTerminal ||
      isThisMessageStopped ||
      isMessageFinished ||
      Boolean(metadata?.finding && !isThisMessageStopped);

    // Network connectivity tracking
    const [isOnline, setIsOnline] = useState(
      typeof navigator === "undefined" ? true : navigator.onLine
    );
    useEffect(() => {
      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }, []);

    // Active execution tracking: authoritative tracker state takes precedence unless terminal
    const isTrackerActive =
      !isTerminal &&
      (execState === "STARTING" ||
        execState === "RUNNING" ||
        (execState === "WAITING" && isLoading) ||
        execState === "WAITING_FOR_USER" ||
        execState === "RESUMING" ||
        execState === "FINALIZING" ||
        execState === "CANCELLING");

    const isToolStreamActive = isLoading && !isTerminal && hasAnyActiveTool;

    // A frontend stream error or disconnect must NOT mark an active backend QA test as failed!
    const isError =
      !isTrackerActive &&
      (Boolean(errorPart) ||
        execState === "FAILED" ||
        execState === "TIMED_OUT" ||
        metadata?.status === "failed" ||
        metadata?.status === "error" ||
        Boolean(metadata?.errorMessage));

    const isAnyRunning =
      !isTerminal &&
      !isError &&
      !isThisMessageStopped &&
      execState !== "CANCELLED" &&
      (isTrackerActive || isToolStreamActive);

    // Track active execution duration
    useEffect(() => {
      let interval: NodeJS.Timeout | null = null;
      const isWaitingForUser = execState === "WAITING_FOR_USER";

      if (isWaitingForUser) {
        if (pauseStartRef.current === null) {
          pauseStartRef.current = Date.now();
        }
      } else if (pauseStartRef.current !== null) {
        totalPausedMsRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
      }

      if (isAnyRunning && !isWaitingForUser) {
        if (startTimeRef.current === null) {
          const runStartedAt = metadata?.startedAt
            ? new Date(metadata.startedAt).getTime()
            : Date.now();
          startTimeRef.current =
            !Number.isNaN(runStartedAt) && runStartedAt > 0
              ? runStartedAt
              : Date.now();
          totalPausedMsRef.current = 0;
          setElapsedSeconds(
            Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000))
          );
        }
        interval = setInterval(() => {
          if (startTimeRef.current) {
            const activeMs =
              Date.now() - startTimeRef.current - totalPausedMsRef.current;
            setElapsedSeconds(Math.max(1, Math.floor(activeMs / 1000)));
          }
        }, 1000);
      } else if (!isAnyRunning && startTimeRef.current !== null) {
        const finalSecs = Math.max(
          1,
          Math.ceil(
            (Date.now() - startTimeRef.current - totalPausedMsRef.current) /
              1000
          )
        );
        setPersistedDuration(finalSecs);
        setElapsedSeconds(finalSecs);
        startTimeRef.current = null;
        totalPausedMsRef.current = 0;
        pauseStartRef.current = null;
      }

      return () => {
        if (interval) {
          clearInterval(interval);
        }
      };
    }, [isAnyRunning, execState, metadata?.startedAt]);

    // Build Lightweight Action Items
    const actions: ActionItem[] = useMemo(() => {
      const items: ActionItem[] = [];

      // 1. Session Initialization
      if (startTestSessionPart) {
        const rawTargetUrl =
          startTestSessionPart.input?.targetUrl ||
          startTestSessionPart.output?.targetUrl ||
          metadata?.targetUrl;
        const targetInfo = formatTargetDomain(rawTargetUrl);
        const isPartError =
          startTestSessionPart.state === "output-error" ||
          Boolean(startTestSessionPart.output?.error);

        const primaryLabel = targetInfo.full
          ? `Navigate to ${targetInfo.domain}`
          : "Connect to browser session";
        const secondaryDetail = targetInfo.full
          ? `Opened ${targetInfo.domain}`
          : "Browser session initialized";

        items.push({
          actionType: "navigate",
          detail: isPartError ? undefined : secondaryDetail,
          error: isPartError
            ? String(startTestSessionPart.output?.error || "Connection failed")
            : undefined,
          id: startTestSessionPart.toolCallId || "start-session",
          label: primaryLabel,
          status:
            startTestSessionPart.state === "output-available" && !isPartError
              ? "completed"
              : isPartError
                ? "failed"
                : "running",
        });
      }

      // 2. High-level Browser Steps
      for (const [idx, stepPart] of runBrowserStepParts.entries()) {
        const rawInstruction =
          stepPart.input?.instruction || "Execute browser task";
        const stepCount = stepPart.output?.stepCount;
        const isPartError =
          stepPart.state === "output-error" || Boolean(stepPart.output?.error);

        const status =
          stepPart.state === "output-available" && !isPartError
            ? "completed"
            : isPartError
              ? "failed"
              : isThisMessageStopped ||
                  execState === "CANCELLING" ||
                  !isAnyRunning
                ? "completed"
                : "running";

        let detail: string | undefined;
        if (isPartError) {
          detail = undefined;
        } else if (stepPart.output?.lastConfirmedAction) {
          detail = String(stepPart.output.lastConfirmedAction);
        } else if (stepCount && stepCount > 1) {
          detail = `Completed ${stepCount} actions`;
        } else if (status === "completed") {
          detail = "Action completed";
        } else if (status === "running") {
          detail = "Executing action in browser...";
        }

        items.push({
          actionType: getActionType(rawInstruction, detail),
          detail,
          error: isPartError
            ? String(stepPart.output?.error || "Action failed")
            : undefined,
          id: stepPart.toolCallId || `step-${idx}`,
          label: rawInstruction,
          status,
        });
      }

      // 3. Evaluation & Assertion Step (Only if not cancelled)
      if (
        !isThisMessageStopped &&
        execState !== "CANCELLING" &&
        execState !== "CANCELLED" &&
        (evaluateTestResultPart ||
          execState === "FINALIZING" ||
          execState === "COMPLETED")
      ) {
        const isPartError =
          evaluateTestResultPart?.state === "output-error" ||
          Boolean(evaluateTestResultPart?.output?.error);

        const status =
          (evaluateTestResultPart?.state === "output-available" ||
            execState === "COMPLETED") &&
          !isPartError
            ? "completed"
            : isPartError
              ? "failed"
              : "running";

        const findingTitle =
          evaluateTestResultPart?.output?.title &&
          evaluateTestResultPart.output?.title !== "Test Stopped"
            ? evaluateTestResultPart.output.title
            : metadata?.finding?.title &&
                metadata.finding.title !== "Test Stopped"
              ? metadata.finding.title
              : undefined;

        const detail = isPartError
          ? undefined
          : findingTitle
            ? String(findingTitle)
            : status === "completed"
              ? "Verification successful"
              : "Asserting outcome & recording findings";

        items.push({
          actionType: "verify",
          detail,
          error: isPartError
            ? String(evaluateTestResultPart?.output?.error)
            : undefined,
          id: evaluateTestResultPart?.toolCallId || "eval-result",
          label: "Verify test outcome",
          status,
        });
      }

      return items;
    }, [
      startTestSessionPart,
      runBrowserStepParts,
      evaluateTestResultPart,
      metadata?.targetUrl,
      metadata?.finding?.title,
      execState,
      isThisMessageStopped,
      isAnyRunning,
    ]);

    // Descriptive live summary text projected from canonical state
    const activeDescription = useMemo(() => {
      if (execState === "RESUMING") {
        return (
          (metadata?.currentAction !== "Test was stopped by user." &&
            metadata?.currentAction) ||
          "Reconnecting to the test..."
        );
      }

      if (execState === "CANCELLING") {
        return "Cancelling...";
      }

      if (!isOnline && isAnyRunning) {
        return "Connection interrupted — your test is still running.";
      }

      if (isThisMessageStopped || execState === "CANCELLED") {
        return "Test was stopped by user.";
      }

      if (execState === "WAITING_FOR_USER") {
        return metadata?.currentAction || "Waiting for your input...";
      }

      if (execState === "TIMED_OUT") {
        return "Test timed out before completion.";
      }

      if (isError) {
        const errMessage =
          metadata?.errorMessage ||
          (errorPart?.output && typeof errorPart.output === "object"
            ? (errorPart.output as Record<string, unknown>).error
            : null);
        return errMessage
          ? `Couldn't complete the browser test: ${String(errMessage)}`
          : "Couldn't complete the browser test.";
      }

      // 1. Initial Starting phase
      if (isAnyRunning && (isStartRunning || execState === "STARTING")) {
        const target =
          startTestSessionPart?.input?.targetUrl || metadata?.targetUrl;
        return target
          ? `Opening ${target}...`
          : "Connecting to browser session...";
      }

      // 2. Active Browser Step Execution phase
      if (isAnyRunning && (isRunStepRunning || execState === "RUNNING")) {
        if (
          metadata?.currentAction &&
          metadata.currentAction !== "Test was stopped by user." &&
          metadata.currentAction !== "Stopping test execution..."
        ) {
          const actionText = metadata.currentAction;
          return actionText.endsWith("...") ? actionText : `${actionText}...`;
        }

        const activeStep = runBrowserStepParts.find(
          (p) => p.state === "input-available" || p.state === "input-streaming"
        );
        const instruction = activeStep?.input?.instruction;
        if (instruction) {
          const lower = instruction.toLowerCase().trim();
          if (lower.startsWith("test") || lower.startsWith("check")) {
            return `${lower}...`;
          }
          return `Executing: ${instruction}...`;
        }
        return "Working...";
      }

      // 3. Waiting / Analyzing Phase (Browser action completed, awaiting assertions)
      if (isAnyRunning && execState === "WAITING") {
        return metadata?.currentAction || "Waiting for browser...";
      }

      // 4. Finalizing / Verification Phase
      if (isAnyRunning && (isEvalRunning || execState === "FINALIZING")) {
        return "Finishing verification...";
      }

      // 5. Completed Phase
      if (
        evaluateTestResultPart?.output?.title &&
        evaluateTestResultPart.output?.title !== "Test Stopped"
      ) {
        return `Verification complete: ${evaluateTestResultPart.output.title}`;
      }

      if (
        metadata?.finding?.title &&
        metadata.finding?.title !== "Test Stopped"
      ) {
        return `Verification complete: ${metadata.finding.title}`;
      }

      if (execState === "COMPLETED" || metadata?.status === "completed") {
        return "Test execution completed.";
      }

      // 6. Streaming continuation fallback
      if (isLoading) {
        return "Working...";
      }

      return "Test completed.";
    }, [
      isAnyRunning,
      isThisMessageStopped,
      execState,
      isError,
      isStartRunning,
      isRunStepRunning,
      isEvalRunning,
      isLoading,
      errorPart,
      metadata?.errorMessage,
      metadata?.targetUrl,
      metadata?.currentAction,
      metadata?.finding,
      metadata?.status,
      startTestSessionPart,
      runBrowserStepParts,
      evaluateTestResultPart,
      isOnline,
    ]);

    const validActions = useMemo(
      () => actions.filter((a) => Boolean(a.label?.trim())),
      [actions]
    );

    const backendDuration = useMemo(() => {
      const start = metadata?.startedAt
        ? new Date(metadata.startedAt).getTime()
        : null;
      const end = metadata?.completedAt
        ? new Date(metadata.completedAt).getTime()
        : metadata?.cancelledAt
          ? new Date(metadata.cancelledAt).getTime()
          : null;
      if (start && end && end >= start) {
        return Math.max(1, Math.round((end - start) / 1000));
      }
      return null;
    }, [metadata?.startedAt, metadata?.completedAt, metadata?.cancelledAt]);

    // Duration formatting for subtle AI-assistant header
    const durationDisplay = useMemo(() => {
      if (execState === "RESUMING") {
        return "Resuming...";
      }
      if (execState === "CANCELLING") {
        return "Cancelling...";
      }
      if (execState === "WAITING_FOR_USER") {
        return "Waiting for your answer";
      }
      if (!isOnline && isAnyRunning) {
        return "Reconnecting…";
      }
      if (isAnyRunning) {
        return elapsedSeconds > 0
          ? `Working for ${elapsedSeconds}s`
          : "Working…";
      }
      if (persistedDuration !== null) {
        return `Worked for ${persistedDuration}s`;
      }
      if (backendDuration !== null) {
        return `Worked for ${backendDuration}s`;
      }
      if (elapsedSeconds > 0) {
        return `Worked for ${elapsedSeconds}s`;
      }
      const totalSteps = validActions.length;
      return totalSteps > 0
        ? `Worked for ${Math.max(2, totalSteps * 3)}s`
        : "Worked for a few seconds";
    }, [
      execState,
      isAnyRunning,
      elapsedSeconds,
      persistedDuration,
      backendDuration,
      validActions.length,
      isOnline,
    ]);

    return (
      <Collapsible
        className={cn(
          "not-prose w-full max-w-[min(100%,560px)] select-text",
          className
        )}
        onOpenChange={setIsOpen}
        open={isOpen && validActions.length > 0}
      >
        {/* Subtle, premium header: ✦ Working for 13s ˅   [■ Stop] */}
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger
            className={cn(
              "group inline-flex h-[calc(13px*1.65)] items-center gap-1.5 text-xs text-muted-foreground/75 transition-colors select-none",
              validActions.length > 0
                ? "hover:text-foreground cursor-pointer"
                : "cursor-default pointer-events-none"
            )}
          >
            <SparkleMiniIcon className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground/80" />
            <span className="font-normal leading-none">{durationDisplay}</span>
            {validActions.length > 0 && (
              <ChevronDownIcon
                className={cn(
                  "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-200 group-hover:text-foreground",
                  isOpen ? "rotate-180" : "rotate-0"
                )}
              />
            )}
          </CollapsibleTrigger>

          {Boolean(isAnyRunning) && (
            <button
              className="inline-flex items-center gap-1 rounded border border-border/50 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground select-none cursor-pointer"
              data-testid="agent-processing-stop-button"
              onClick={handleStop}
              title="Stop test execution"
              type="button"
            >
              <Square className="size-2.5 fill-current" />
              <span>Stop</span>
            </button>
          )}
        </div>

        {/* Live / completed description */}
        {activeDescription && (
          <div className="mt-1 text-[13px] leading-relaxed">
            {isAnyRunning ? (
              <Shimmer
                className="font-medium text-foreground whitespace-normal break-words"
                duration={1.8}
              >
                {activeDescription}
              </Shimmer>
            ) : (
              <span
                className={cn(
                  "whitespace-normal break-words",
                  isError
                    ? "font-medium text-destructive"
                    : "text-muted-foreground/85"
                )}
              >
                {activeDescription}
              </span>
            )}
          </div>
        )}

        {/* Lightweight Execution Steps (No heavy boxes, no arrows, clean semantic icons) */}
        {validActions.length > 0 && (
          <CollapsibleContent className="mt-1.5 space-y-1 pl-0.5 overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1.5 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1.5 duration-200 ease-out">
            {validActions.map((action) => (
              <div
                className="group/row flex items-start gap-2.5 py-1 text-left transition-colors"
                key={action.id}
              >
                {renderStepIcon(action)}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-1.5">
                    {action.status === "running" ? (
                      <Shimmer
                        className="text-[13px] font-medium leading-snug"
                        duration={1.2}
                      >
                        {action.label}
                      </Shimmer>
                    ) : (
                      <span
                        className={cn(
                          "truncate text-[13px] font-medium leading-snug",
                          action.status === "failed"
                            ? "text-destructive"
                            : "text-foreground/90 group-hover/row:text-foreground"
                        )}
                      >
                        {action.label}
                      </span>
                    )}
                    {action.error ? (
                      <span className="shrink-0 truncate text-[11px] text-destructive">
                        ({action.error})
                      </span>
                    ) : null}
                  </div>
                  {action.detail ? (
                    <span className="mt-0.5 truncate text-[11px] leading-normal text-muted-foreground/75">
                      {action.detail}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        )}

        {/* Downloads section */}
        {metadata?.downloads && metadata.downloads.length > 0 && (
          <AgentDownloads downloads={metadata.downloads} />
        )}
      </Collapsible>
    );
  }
);

AgentProcessing.displayName = "AgentProcessing";
