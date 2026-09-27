"use client";

import { ChevronDownIcon } from "lucide-react";
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

interface ActionItem {
  error?: string;
  id: string;
  label: string;
  status: "completed" | "failed" | "pending" | "running";
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

    const execState = metadata?.executionState;
    const isCanonicalTerminal = isTerminalExecutionState(execState);

    const isPartStopped = parts.some(
      (p) =>
        Boolean(p.output?.isStopped) ||
        p.output?.output === "Test execution was stopped by user."
    );

    const isCancelled =
      execState === "CANCELLED" ||
      metadata?.status === "cancelled" ||
      metadata?.status === "stopped" ||
      isPartStopped;

    const isError =
      Boolean(errorPart) ||
      execState === "FAILED" ||
      execState === "TIMED_OUT" ||
      Boolean(metadata?.errorMessage);

    // Historical messages must NEVER be inferred as active execution.
    // An execution is ONLY active if the stream is live (isLoading) or tracker explicitly says so.
    const isTrackerActive =
      execState === "STARTING" ||
      execState === "RUNNING" ||
      execState === "WAITING" ||
      execState === "FINALIZING" ||
      execState === "CANCELLING";

    const isToolStreamActive =
      isLoading && (isStartRunning || isRunStepRunning || isEvalRunning);

    const isAnyRunning =
      !isError &&
      !isCancelled &&
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

    // Build Action Items (integrating fine-grained Browser Use sub-steps)
    const actions: ActionItem[] = useMemo(() => {
      const items: ActionItem[] = [];

      // 1. Session Initialization
      if (startTestSessionPart) {
        const targetUrl =
          startTestSessionPart.input?.targetUrl ||
          startTestSessionPart.output?.targetUrl ||
          metadata?.targetUrl;
        const isPartError =
          startTestSessionPart.state === "output-error" ||
          Boolean(startTestSessionPart.output?.error);

        items.push({
          error: isPartError
            ? String(startTestSessionPart.output?.error || "Connection failed")
            : undefined,
          id: startTestSessionPart.toolCallId || "start-session",
          label: targetUrl
            ? `Connect to ${targetUrl}`
            : "Connect to browser session",
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
        const instruction =
          stepPart.input?.instruction || "Execute browser task";
        const stepCount = stepPart.output?.stepCount;
        const isPartError =
          stepPart.state === "output-error" || Boolean(stepPart.output?.error);

        items.push({
          error: isPartError
            ? String(stepPart.output?.error || "Action failed")
            : undefined,
          id: stepPart.toolCallId || `step-${idx}`,
          label:
            stepCount && stepCount > 1
              ? `${instruction} (${stepCount} steps)`
              : instruction,
          status:
            stepPart.state === "output-available" && !isPartError
              ? "completed"
              : isPartError
                ? "failed"
                : isCancelled || execState === "CANCELLING" || !isAnyRunning
                  ? "completed"
                  : "running",
        });
      }

      // 3. Evaluation & Assertion Step (Only if not cancelled or cancelling)
      if (
        !isCancelled &&
        execState !== "CANCELLING" &&
        (evaluateTestResultPart ||
          execState === "FINALIZING" ||
          execState === "COMPLETED")
      ) {
        const isPartError =
          evaluateTestResultPart?.state === "output-error" ||
          Boolean(evaluateTestResultPart?.output?.error);

        items.push({
          error: isPartError
            ? String(evaluateTestResultPart?.output?.error)
            : undefined,
          id: evaluateTestResultPart?.toolCallId || "eval-result",
          label: "Verify test outcome & record findings",
          status:
            (evaluateTestResultPart?.state === "output-available" ||
              execState === "COMPLETED") &&
            !isPartError
              ? "completed"
              : isPartError
                ? "failed"
                : "running",
        });
      }

      return items;
    }, [
      startTestSessionPart,
      runBrowserStepParts,
      evaluateTestResultPart,
      metadata?.targetUrl,
      execState,
      isCancelled,
      isAnyRunning,
    ]);

    // Descriptive live summary text projected from canonical state
    const activeDescription = useMemo(() => {
      if (execState === "CANCELLING") {
        return "Stopping test execution...";
      }

      if (isCancelled) {
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
        if (metadata?.currentAction) {
          return `${metadata.currentAction}...`;
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
        return "Testing the application in live browser...";
      }

      // 3. Waiting / Analyzing Phase (Browser action completed, awaiting assertions)
      if (isAnyRunning && execState === "WAITING") {
        return (
          metadata?.currentAction ||
          "Analyzing browser outcome and verifying state..."
        );
      }

      // 4. Finalizing / Verification Phase
      if (isAnyRunning && (isEvalRunning || execState === "FINALIZING")) {
        return "Verifying assertions and recording findings...";
      }

      // 5. Completed Phase
      if (evaluateTestResultPart?.output?.title) {
        return `Verification complete: ${evaluateTestResultPart.output.title}`;
      }

      if (execState === "COMPLETED" || metadata?.status === "completed") {
        return "Test execution completed.";
      }

      // 6. Streaming continuation fallback (never premature 'Test completed')
      if (isLoading) {
        return "Finalizing test summary...";
      }

      return "Test completed.";
    }, [
      isAnyRunning,
      isCancelled,
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
      metadata?.status,
      startTestSessionPart,
      runBrowserStepParts,
      evaluateTestResultPart,
    ]);

    const validActions = useMemo(
      () => actions.filter((a) => Boolean(a.label?.trim())),
      [actions]
    );

    // Duration formatting
    const durationDisplay = useMemo(() => {
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
      // Historical fallback based on step count
      const totalSteps = validActions.length;
      return totalSteps > 0
        ? `Worked for ${Math.max(2, totalSteps * 3)}s`
        : "Worked for a few seconds";
    }, [isAnyRunning, elapsedSeconds, persistedDuration, validActions.length]);

    return (
      <Collapsible
        className={cn(
          "not-prose my-1.5 w-full max-w-[min(100%,560px)] select-text",
          className
        )}
        onOpenChange={setIsOpen}
        open={isOpen && validActions.length > 0}
      >
        {/* Header with Worked for Xs and Chevron if items exist */}
        <CollapsibleTrigger
          className={cn(
            "group flex items-center gap-1.5 text-muted-foreground/80 text-xs transition-colors",
            validActions.length > 0
              ? "hover:text-foreground cursor-pointer"
              : "cursor-default pointer-events-none"
          )}
        >
          <span className="font-normal">{durationDisplay}</span>
          {validActions.length > 0 && (
            <ChevronDownIcon
              className={cn(
                "size-3.5 text-muted-foreground/60 transition-transform duration-200 group-hover:text-foreground",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          )}
        </CollapsibleTrigger>

        {/* Live / completed description */}
        <div className="mt-1 text-[13px] leading-relaxed">
          {isAnyRunning ? (
            <Shimmer
              className="font-medium text-foreground whitespace-normal break-words"
              duration={1.5}
            >
              {activeDescription}
            </Shimmer>
          ) : (
            <span
              className={cn(
                "whitespace-normal break-words",
                isError
                  ? "text-destructive font-medium"
                  : "text-muted-foreground/90"
              )}
            >
              {activeDescription}
            </span>
          )}
        </div>

        {/* Expandable Action Steps only if real actions exist */}
        {validActions.length > 0 && (
          <CollapsibleContent className="mt-2.5 space-y-1.5 border-border/20 border-l pl-2 text-xs">
            {validActions.map((action) => (
              <div className="flex items-center gap-2 py-0.5" key={action.id}>
                {action.status === "completed" && (
                  <span className="select-none text-muted-foreground/60">
                    →
                  </span>
                )}
                {action.status === "running" && (
                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
                )}
                {action.status === "failed" && (
                  <span className="select-none text-destructive">✕</span>
                )}
                {action.status === "pending" && (
                  <span className="select-none text-muted-foreground/40">
                    ◇
                  </span>
                )}

                {action.status === "running" ? (
                  <Shimmer className="text-xs" duration={1.2}>
                    {action.label}
                  </Shimmer>
                ) : (
                  <span
                    className={cn(
                      "text-xs leading-normal",
                      action.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground/80"
                    )}
                  >
                    {action.label}
                    {action.error ? (
                      <span className="ml-1.5 text-destructive/90 text-xs">
                        ({action.error})
                      </span>
                    ) : null}
                  </span>
                )}
              </div>
            ))}
          </CollapsibleContent>
        )}
      </Collapsible>
    );
  }
);

AgentProcessing.displayName = "AgentProcessing";
