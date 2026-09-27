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
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useArtifact } from "@/hooks/use-artifact";
import { isTerminalExecutionState } from "@/lib/qa/execution-types";
import { cn } from "@/lib/utils";
import { Shimmer } from "../ai-elements/shimmer";

export interface AgentProcessingProps {
  className?: string;
  isLoading?: boolean;
  messageId: string;
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

export const AgentProcessing = memo(
  ({
    className,
    isLoading = false,
    messageId: _messageId,
    parts,
  }: AgentProcessingProps) => {
    const { metadata } = useArtifact();
    const [isOpen, setIsOpen] = useState(true);
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
    const [persistedDuration, setPersistedDuration] = useState<number | null>(
      null
    );
    const startTimeRef = useRef<number | null>(null);

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

    // If this message was stopped, its state is frozen at CANCELLED and never affected by future runs
    const execState = isThisMessageStopped
      ? "CANCELLED"
      : metadata?.executionState;
    const isCanonicalTerminal = isTerminalExecutionState(execState);

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

    // Active execution tracking: authoritative tracker state takes precedence
    const isTrackerActive =
      execState === "STARTING" ||
      execState === "RUNNING" ||
      execState === "WAITING" ||
      execState === "RESUMING" ||
      execState === "FINALIZING" ||
      execState === "CANCELLING";

    const isToolStreamActive =
      isLoading && (isStartRunning || isRunStepRunning || isEvalRunning);

    // A frontend stream error or disconnect must NOT mark an active backend QA test as failed!
    const isError =
      !isTrackerActive &&
      (Boolean(errorPart) ||
        execState === "FAILED" ||
        execState === "TIMED_OUT" ||
        Boolean(metadata?.errorMessage));

    const isAnyRunning =
      !isError &&
      !isThisMessageStopped &&
      execState !== "CANCELLED" &&
      !isCanonicalTerminal &&
      (isTrackerActive || isToolStreamActive);

    // Track active execution duration
    useEffect(() => {
      let interval: NodeJS.Timeout | null = null;

      if (isAnyRunning) {
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
        interval = setInterval(() => {
          if (startTimeRef.current) {
            setElapsedSeconds(
              Math.max(
                1,
                Math.floor((Date.now() - startTimeRef.current) / 1000)
              )
            );
          }
        }, 1000);
      } else if (startTimeRef.current !== null) {
        const finalSecs = Math.max(
          1,
          Math.ceil((Date.now() - startTimeRef.current) / 1000)
        );
        setPersistedDuration(finalSecs);
        setElapsedSeconds(finalSecs);
        startTimeRef.current = null;
      }

      return () => {
        if (interval) {
          clearInterval(interval);
        }
      };
    }, [isAnyRunning]);

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

    // Duration formatting for subtle AI-assistant header
    const durationDisplay = useMemo(() => {
      if (execState === "RESUMING") {
        return "Resuming...";
      }
      if (execState === "CANCELLING") {
        return "Cancelling...";
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
      validActions.length,
      isOnline,
    ]);

    return (
      <Collapsible
        className={cn(
          "not-prose my-1.5 w-full max-w-[min(100%,560px)] select-text",
          className
        )}
        onOpenChange={setIsOpen}
        open={isOpen && validActions.length > 0}
      >
        {/* Subtle, premium header: ✦ Working for 13s ˅ */}
        <CollapsibleTrigger
          className={cn(
            "group inline-flex items-center gap-1.5 text-xs text-muted-foreground/75 transition-colors select-none",
            validActions.length > 0
              ? "hover:text-foreground cursor-pointer"
              : "cursor-default pointer-events-none"
          )}
        >
          <span className="text-[10px] text-muted-foreground/50 transition-colors group-hover:text-foreground/70">
            ✦
          </span>
          <span className="font-normal">{durationDisplay}</span>
          {validActions.length > 0 && (
            <ChevronDownIcon
              className={cn(
                "size-3 text-muted-foreground/50 transition-transform duration-200 group-hover:text-foreground",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          )}
        </CollapsibleTrigger>

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
          <CollapsibleContent className="mt-2 space-y-1 pl-0.5">
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
      </Collapsible>
    );
  }
);

AgentProcessing.displayName = "AgentProcessing";
