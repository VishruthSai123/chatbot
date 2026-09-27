import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMessages } from "@/hooks/use-messages";
import type { Vote } from "@/lib/db/schema";
import { isTerminalExecutionState } from "@/lib/qa/execution-types";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { Greeting } from "./greeting";
import { SparklesIcon } from "./icons";
import { PreviewMessage, QAToolGroup, ThinkingMessage } from "./message";

type MessagesProps = {
  activeExecution?: any;
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  isArtifactVisible: boolean;
  isLoading?: boolean;
  isReadonly: boolean;
  messages: ChatMessage[];
  onEditMessage?: (message: ChatMessage) => void;
  onStopExecution?: () => void;
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  selectedModelId: string;
  sessionFinding?: any;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  status: UseChatHelpers<ChatMessage>["status"];
  votes: Vote[] | undefined;
};

function buildSyntheticQAParts(execution: any) {
  if (!execution) {
    return [];
  }
  const isTerminal = isTerminalExecutionState(execution.executionState);
  const parts: any[] = [];

  // 1. Session start part
  if (execution.sessionId || execution.targetUrl) {
    parts.push({
      input: { targetUrl: execution.targetUrl || "https://localhost" },
      output: {
        browserSessionId: execution.browserSessionId,
        sessionId: execution.sessionId,
        targetUrl: execution.targetUrl,
      },
      state: "output-available",
      toolCallId: `start-${execution.sessionId || "session"}`,
      type: "tool-startTestSession",
    });
  }

  // 2. High-level Browser Step
  // In QA testing, runBrowserStep represents the task instruction, NOT every individual sub-step.
  const steps = execution.steps || [];
  const isStepRunning =
    !isTerminal &&
    (execution.executionState === "RUNNING" ||
      execution.executionState === "STARTING" ||
      execution.executionState === "WAITING" ||
      execution.executionState === "RESUMING");

  const instructionText =
    execution.originalIntent ||
    execution.currentAction ||
    (steps.length > 0 ? steps[0]?.action : null) ||
    "Execute browser task";

  const lastStepAction =
    steps.length > 0 ? steps.at(-1)?.action : execution.currentAction;

  parts.push({
    input: { instruction: instructionText },
    output: isStepRunning
      ? undefined
      : {
          error: execution.error,
          isStopped: execution.executionState === "CANCELLED",
          lastConfirmedAction: execution.lastConfirmedAction || lastStepAction,
          output:
            execution.executionState === "CANCELLED"
              ? "Test execution was stopped by user."
              : execution.currentAction || "Task completed",
          stepCount: steps.length || 1,
          success: execution.executionState === "COMPLETED",
        },
    state: isStepRunning ? "input-streaming" : "output-available",
    toolCallId: `step-${execution.sessionId || "main"}`,
    type: "tool-runBrowserStep",
  });

  // 3. Evaluation step
  if (
    execution.executionState === "FINALIZING" ||
    execution.executionState === "COMPLETED" ||
    execution.verdict
  ) {
    const isCompleted = execution.executionState === "COMPLETED";
    parts.push({
      input: {},
      output: isCompleted
        ? {
            actual: execution.currentAction || "Verification successful",
            expected: "Test completed",
            findingId: execution.findingId,
            status: execution.verdict || "pass",
            summary: execution.currentAction || "Test execution completed.",
            title:
              execution.verdict === "pass"
                ? "Test Passed"
                : execution.currentAction || "Test Completed",
          }
        : undefined,
      state: isCompleted ? "output-available" : "input-streaming",
      toolCallId: `eval-${execution.sessionId || "result"}`,
      type: "tool-evaluateTestResult",
    });
  }

  return parts;
}

function PureMessages({
  activeExecution,
  addToolApprovalResponse,
  chatId,
  isArtifactVisible,
  isLoading,
  isReadonly,
  messages,
  onEditMessage,
  onStopExecution,
  regenerate,
  selectedModelId: _selectedModelId,
  sessionFinding: _sessionFinding,
  setMessages,
  status,
  votes,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
    reset,
  } = useMessages({
    status,
  });

  useDataStream();

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      reset();
    }
  }, [chatId, reset]);

  const lastMessage = messages.at(-1);
  const isLastMessageAssistantWithTools =
    lastMessage?.role === "assistant" &&
    (status === "streaming" ||
      lastMessage.parts?.some(
        (p) =>
          p.type === "tool-startTestSession" ||
          p.type === "tool-runBrowserStep" ||
          p.type === "tool-requestUserClarification" ||
          p.type === "tool-evaluateTestResult"
      ));

  const isExecutionTerminal = isTerminalExecutionState(
    activeExecution?.executionState
  );

  // If the chat messages already contain an assistant message with tools or results,
  // do not render a duplicate synthetic hydrated block!
  const hasExistingAssistantQA = messages.some(
    (m) =>
      m.role === "assistant" &&
      m.parts?.some(
        (p) =>
          p.type === "tool-startTestSession" ||
          p.type === "tool-runBrowserStep" ||
          p.type === "tool-requestUserClarification" ||
          p.type === "tool-evaluateTestResult"
      )
  );

  const shouldRenderHydratedExecution = Boolean(
    activeExecution &&
      (!isExecutionTerminal || !hasExistingAssistantQA) &&
      !isLastMessageAssistantWithTools
  );

  const syntheticQAParts = useMemo(() => {
    if (!shouldRenderHydratedExecution || !activeExecution) {
      return [];
    }
    return buildSyntheticQAParts(activeExecution);
  }, [shouldRenderHydratedExecution, activeExecution]);

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  return (
    <div className="relative flex-1 bg-background">
      {messages.length === 0 &&
        !isLoading &&
        !shouldRenderHydratedExecution && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <Greeting />
          </div>
        )}
      <div
        className={cn(
          "absolute inset-0 touch-pan-y overflow-y-auto",
          messages.length > 0 || shouldRenderHydratedExecution
            ? "bg-background"
            : "bg-transparent"
        )}
        ref={messagesContainerRef}
        style={isArtifactVisible ? { scrollbarWidth: "none" } : undefined}
      >
        <div className="mx-auto flex min-h-full min-w-0 max-w-4xl flex-col gap-5 px-2 py-6 md:gap-7 md:px-4">
          {messages.map((message, index) => (
            <PreviewMessage
              addToolApprovalResponse={addToolApprovalResponse}
              chatId={chatId}
              isLoading={
                status === "streaming" && messages.length - 1 === index
              }
              isReadonly={isReadonly}
              key={message.id}
              message={message}
              onEdit={onEditMessage}
              regenerate={regenerate}
              requiresScrollPadding={
                hasSentMessage && index === messages.length - 1
              }
              setMessages={setMessages}
              vote={
                votes
                  ? votes.find((vote) => vote.messageId === message.id)
                  : undefined
              }
            />
          ))}

          {status === "submitted" && messages.at(-1)?.role !== "assistant" && (
            <ThinkingMessage />
          )}

          {Boolean(shouldRenderHydratedExecution) && (
            <div
              className="group/message w-full"
              data-role="assistant"
              data-testid="message-assistant-rehydrated"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
                    <SparklesIcon size={13} />
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <QAToolGroup
                    chatId={chatId}
                    isLoading={
                      !isTerminalExecutionState(activeExecution?.executionState)
                    }
                    key={`rehydrated-qa-${activeExecution.runId}`}
                    messageId={`rehydrated-run-${activeExecution.runId}`}
                    onStop={onStopExecution}
                    qaParts={syntheticQAParts}
                  />
                </div>
              </div>
            </div>
          )}

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </div>
      </div>

      <button
        aria-label="Scroll to bottom"
        className={`absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg transition-all duration-200 h-7 text-[10px] ${
          isAtBottom
            ? "pointer-events-none scale-90 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        }`}
        onClick={handleScrollToBottom}
        type="button"
      >
        <ArrowDownIcon className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}

export const Messages = PureMessages;
