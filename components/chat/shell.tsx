"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  initialArtifactData,
  useArtifactActions,
  useArtifactMetadataSelector,
  useArtifactSelector,
} from "@/hooks/use-artifact";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn, fetcher } from "@/lib/utils";
import { Artifact } from "./artifact";
import { ChatHeader } from "./chat-header";
import { DataStreamHandler } from "./data-stream-handler";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    currentModelId,
    setCurrentModelId,
    showCreditCardAlert,
    setShowCreditCardAlert,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const isBrowser = useArtifactSelector((state) => state.kind === "browser");
  const isFullscreen = useArtifactMetadataSelector((meta) =>
    Boolean(meta?.isFullscreen)
  );
  const { setArtifact, setMetadata } = useArtifactActions();

  // Restore active browser session and execution state on page load/refresh/reconnect
  const { data: sessionData } = useSWR<{
    session: {
      id: string;
      browserSessionId: string;
      liveUrl: string | null;
      targetUrl: string;
      status: string;
    } | null;
    execution: any;
  }>(chatId ? `/api/qa/session?chatId=${chatId}` : null, fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const hasRestoredSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const s = sessionData?.session;
    const exec = sessionData?.execution;

    if (s?.liveUrl && hasRestoredSessionRef.current !== s.id) {
      hasRestoredSessionRef.current = s.id;
      setArtifact((prev) => {
        if (prev.isVisible) {
          return prev;
        }
        return {
          ...prev,
          documentId: s.id,
          isVisible: true,
          kind: "browser",
          status: s.status === "active" ? "streaming" : "idle",
          title: s.targetUrl || "Live Browser",
        };
      });
    }

    if (s && setMetadata) {
      setMetadata((prev: Record<string, unknown> | null) => {
        const safePrev = prev ?? {};
        const isSameRun =
          !exec?.runId || !safePrev?.runId || exec.runId === safePrev.runId;
        const isNewerSequence = Boolean(
          exec?.sequence &&
            safePrev?.sequence &&
            exec.sequence > safePrev.sequence
        );
        const isResumingOrStarting =
          exec?.executionState === "RESUMING" ||
          exec?.executionState === "STARTING" ||
          exec?.executionState === "RUNNING";

        if (
          (safePrev.executionState === "CANCELLED" ||
            safePrev.executionState === "CANCELLING") &&
          exec?.executionState !== "CANCELLED" &&
          isSameRun &&
          !isNewerSequence &&
          !isResumingOrStarting
        ) {
          return safePrev;
        }

        if (
          isSameRun &&
          safePrev.sequence &&
          exec?.sequence &&
          exec.sequence < safePrev.sequence
        ) {
          return safePrev;
        }

        return {
          ...safePrev,
          browserSessionId: s.browserSessionId || safePrev.browserSessionId,
          liveUrl: s.liveUrl ?? safePrev.liveUrl,
          status: s.status === "active" ? "live" : safePrev.status || "idle",
          targetUrl: s.targetUrl || safePrev.targetUrl,
          ...(exec
            ? {
                currentAction: exec.currentAction || safePrev.currentAction,
                executionState: exec.executionState || safePrev.executionState,
                findingId: exec.findingId || safePrev.findingId,
                recentSteps: exec.steps || safePrev.recentSteps,
                runId: exec.runId || safePrev.runId,
                sequence: exec.sequence || safePrev.sequence,
                verdict: exec.verdict || safePrev.verdict,
              }
            : {}),
        };
      });
    }
  }, [sessionData, setArtifact, setMetadata]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      hasRestoredSessionRef.current = null;
      stopRef.current();
      setArtifact(initialArtifactData);
      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId, setArtifact]);

  const handleEditMessage = useCallback(
    (msg: ChatMessage) => {
      const text = msg.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      setInput(text ?? "");
      setEditingMessage(msg);
    },
    [setInput]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setInput("");
  }, [setInput]);

  const handleSendEditedMessage = useCallback(async () => {
    if (!editingMessage) {
      return;
    }

    const msg = editingMessage;
    setEditingMessage(null);
    await submitEditedMessage({
      message: msg,
      regenerate,
      setMessages,
      text: input,
    });
    setInput("");
  }, [editingMessage, input, regenerate, setInput, setMessages]);

  const handleActivateGateway = useCallback(() => {
    window.open(
      "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
      "_blank"
    );
    window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
  }, []);

  return (
    <>
      <div className="flex h-dvh w-full flex-row overflow-hidden">
        <div
          className={cn(
            "flex min-w-0 flex-col bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            isArtifactVisible
              ? isBrowser && isFullscreen
                ? "w-0 hidden"
                : isBrowser
                  ? "w-[55%] lg:w-[58%]"
                  : "w-[40%]"
              : "w-full"
          )}
        >
          <ChatHeader
            chatId={chatId}
            isReadonly={isReadonly}
            selectedVisibilityType={visibilityType}
          />

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
            <Messages
              addToolApprovalResponse={addToolApprovalResponse}
              chatId={chatId}
              isArtifactVisible={isArtifactVisible}
              isLoading={isLoading}
              isReadonly={isReadonly}
              messages={messages}
              onEditMessage={handleEditMessage}
              regenerate={regenerate}
              selectedModelId={currentModelId}
              setMessages={setMessages}
              status={status}
              votes={votes}
            />

            <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
              {!isReadonly && (
                <MultimodalInput
                  attachments={attachments}
                  chatId={chatId}
                  editingMessage={editingMessage}
                  input={input}
                  isLoading={isLoading}
                  messages={messages}
                  onCancelEdit={handleCancelEdit}
                  onModelChange={setCurrentModelId}
                  selectedModelId={currentModelId}
                  selectedVisibilityType={visibilityType}
                  sendMessage={
                    editingMessage ? handleSendEditedMessage : sendMessage
                  }
                  setAttachments={setAttachments}
                  setInput={setInput}
                  setMessages={setMessages}
                  status={status}
                  stop={stop}
                />
              )}
            </div>
          </div>
        </div>

        <Artifact
          addToolApprovalResponse={addToolApprovalResponse}
          attachments={attachments}
          chatId={chatId}
          input={input}
          isReadonly={isReadonly}
          messages={messages}
          regenerate={regenerate}
          selectedModelId={currentModelId}
          selectedVisibilityType={visibilityType}
          sendMessage={sendMessage}
          setAttachments={setAttachments}
          setInput={setInput}
          setMessages={setMessages}
          status={status}
          stop={stop}
          votes={votes}
        />
      </div>

      <DataStreamHandler />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleActivateGateway}>
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
