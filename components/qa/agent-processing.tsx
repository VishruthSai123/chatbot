"use client";

import { ChevronDownIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useArtifact } from "@/hooks/use-artifact";
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

    // Identify tool parts
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

    const isError = Boolean(errorPart);
    const isAnyRunning =
      !isError &&
      (isLoading || isStartRunning || isRunStepRunning || isEvalRunning);

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

    // Build Action Items
    const actions: ActionItem[] = useMemo(() => {
      const items: ActionItem[] = [];

      if (startTestSessionPart) {
        const targetUrl =
          startTestSessionPart.input?.targetUrl ||
          startTestSessionPart.output?.targetUrl;
        const isPartError =
          startTestSessionPart.state === "output-error" ||
          Boolean(startTestSessionPart.output?.error);

        items.push({
          error: isPartError
            ? String(startTestSessionPart.output?.error || "Connection failed")
            : undefined,
          id: startTestSessionPart.toolCallId || "start-session",
          label: targetUrl
            ? `Navigate to ${targetUrl}`
            : "Connect to browser session",
          status:
            startTestSessionPart.state === "output-available" && !isPartError
              ? "completed"
              : isPartError
                ? "failed"
                : "running",
        });
      }

      runBrowserStepParts.forEach((stepPart, idx) => {
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
                : "running",
        });
      });

      if (evaluateTestResultPart) {
        const isPartError =
          evaluateTestResultPart.state === "output-error" ||
          Boolean(evaluateTestResultPart.output?.error);

        items.push({
          error: isPartError
            ? String(evaluateTestResultPart.output?.error)
            : undefined,
          id: evaluateTestResultPart.toolCallId || "eval-result",
          label: "Verify test outcome & record findings",
          status:
            evaluateTestResultPart.state === "output-available" && !isPartError
              ? "completed"
              : isPartError
                ? "failed"
                : "running",
        });
      }

      return items;
    }, [startTestSessionPart, runBrowserStepParts, evaluateTestResultPart]);

    // Descriptive live summary text
    const activeDescription = useMemo(() => {
      if (isError) {
        const errMessage =
          errorPart?.output && typeof errorPart.output === "object"
            ? (errorPart.output as Record<string, unknown>).error
            : null;
        return errMessage
          ? `Couldn't complete the browser test: ${String(errMessage)}`
          : "Couldn't complete the browser test.";
      }

      if (isStartRunning) {
        const target = startTestSessionPart?.input?.targetUrl;
        return target
          ? `I'm opening ${target}...`
          : "I'm opening the application...";
      }

      if (isRunStepRunning) {
        // Prefer live streaming current action if available
        if (metadata?.currentAction) {
          return `I'm ${metadata.currentAction.toLowerCase()}...`;
        }

        const activeStep = runBrowserStepParts.find(
          (p) => p.state === "input-available" || p.state === "input-streaming"
        );
        const instruction = activeStep?.input?.instruction;
        if (instruction) {
          const lower = instruction.toLowerCase().trim();
          if (lower.startsWith("test") || lower.startsWith("check")) {
            return `I'm ${lower}...`;
          }
          return `I'm executing: ${instruction}...`;
        }
        return "I'm testing the application...";
      }

      if (isEvalRunning) {
        return "I'm verifying the result...";
      }

      if (evaluateTestResultPart?.output?.title) {
        return `Completed verification: ${evaluateTestResultPart.output.title}`;
      }

      return "Test completed.";
    }, [
      isError,
      isStartRunning,
      isRunStepRunning,
      isEvalRunning,
      errorPart,
      startTestSessionPart,
      runBrowserStepParts,
      evaluateTestResultPart,
      metadata?.currentAction,
    ]);

    // Duration formatting
    const durationDisplay = useMemo(() => {
      if (isAnyRunning) {
        return `Working for ${elapsedSeconds || 1}s`;
      }
      if (persistedDuration !== null) {
        return `Worked for ${persistedDuration}s`;
      }
      if (elapsedSeconds > 0) {
        return `Worked for ${elapsedSeconds}s`;
      }
      // Historical fallback based on step count
      const totalSteps = actions.length;
      return totalSteps > 0
        ? `Worked for ${Math.max(2, totalSteps * 3)}s`
        : "Worked for a few seconds";
    }, [isAnyRunning, elapsedSeconds, persistedDuration, actions.length]);

    return (
      <Collapsible
        className={cn(
          "not-prose my-1.5 w-full max-w-[min(100%,560px)] select-text",
          className
        )}
        onOpenChange={setIsOpen}
        open={isOpen}
      >
        {/* Header with Worked for Xs and Chevron */}
        <CollapsibleTrigger className="group flex items-center gap-1.5 text-muted-foreground/80 text-xs transition-colors hover:text-foreground">
          <span className="font-normal">{durationDisplay}</span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform duration-200 group-hover:text-foreground",
              isOpen ? "rotate-180" : "rotate-0"
            )}
          />
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

        {/* Expandable Action Steps */}
        <CollapsibleContent className="mt-2.5 space-y-1.5 border-border/20 border-l pl-2 text-xs">
          {actions.map((action) => (
            <div className="flex items-center gap-2 py-0.5" key={action.id}>
              {action.status === "completed" && (
                <span className="select-none text-muted-foreground/60">→</span>
              )}
              {action.status === "running" && (
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
              )}
              {action.status === "failed" && (
                <span className="select-none text-destructive">✕</span>
              )}
              {action.status === "pending" && (
                <span className="select-none text-muted-foreground/40">◇</span>
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
      </Collapsible>
    );
  }
);

AgentProcessing.displayName = "AgentProcessing";
