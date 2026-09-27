import { Artifact } from "@/components/chat/create-artifact";
import {
  type BrowserArtifactMetadata,
  BrowserPreview,
} from "@/components/qa/browser-preview";
import { isTerminalExecutionState } from "@/lib/qa/execution-types";

export const browserArtifact = new Artifact<"browser", BrowserArtifactMetadata>(
  {
    actions: [],
    content: ({ metadata, setMetadata, title }) => (
      <BrowserPreview
        metadata={metadata}
        setMetadata={setMetadata}
        title={title}
      />
    ),
    description:
      "Live Reality Browser workspace for automated QA testing, verification and exploration.",
    kind: "browser" as const,
    onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
      if (streamPart.type === "data-browser-session") {
        const session = streamPart.data;
        setMetadata((prev) => ({
          ...prev,
          browserScreenHeight: session.browserScreenHeight,
          browserScreenWidth: session.browserScreenWidth,
          browserSessionId: session.browserSessionId,
          liveUrl: session.liveUrl,
          sessionId: session.id,
          status: (session.status as any) || "live",
          targetUrl: session.targetUrl,
        }));

        setArtifact((draftArtifact) => ({
          ...draftArtifact,
          documentId: session.id ?? draftArtifact.documentId,
          isVisible: true,
          kind: "browser",
          status: "streaming",
          title: session.targetUrl || "Live Browser",
        }));
      }

      if (streamPart.type === "data-qa-status") {
        const nextAction =
          typeof streamPart.data === "string" ? streamPart.data : null;
        if (nextAction) {
          setMetadata((prev) => {
            if (
              isTerminalExecutionState(prev?.executionState) ||
              prev?.executionState === "CANCELLED" ||
              prev?.executionState === "CANCELLING" ||
              prev?.currentAction === nextAction
            ) {
              return prev;
            }
            return {
              ...prev,
              currentAction: nextAction,
              status: "working",
            };
          });
        }
      }

      if (streamPart.type === "data-qa-execution") {
        const exec = streamPart.data;
        setMetadata((prev) => {
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

          // If currently CANCELLED or CANCELLING, only reject stale packets from the same run
          if (
            (safePrev.executionState === "CANCELLED" ||
              safePrev.executionState === "CANCELLING") &&
            exec.executionState !== "CANCELLED" &&
            isSameRun &&
            !isNewerSequence &&
            !isResumingOrStarting
          ) {
            return safePrev;
          }

          // Terminal state protection: terminal states can only be transitioned if starting or resuming or newer run
          if (
            isTerminalExecutionState(safePrev.executionState) &&
            !isTerminalExecutionState(exec.executionState) &&
            isSameRun &&
            !isNewerSequence &&
            !isResumingOrStarting
          ) {
            return safePrev;
          }

          // Monotonic sequence check for same run
          if (
            isSameRun &&
            safePrev.sequence &&
            exec.sequence &&
            exec.sequence < safePrev.sequence
          ) {
            return safePrev;
          }

          const isTerminal = isTerminalExecutionState(exec.executionState);
          const computedStatus =
            exec.executionState === "COMPLETED"
              ? "idle"
              : exec.executionState === "FAILED" ||
                  exec.executionState === "TIMED_OUT"
                ? "error"
                : exec.executionState === "CANCELLED"
                  ? "stopped"
                  : "working";

          return {
            ...safePrev,
            currentAction: exec.currentAction || safePrev.currentAction,
            errorMessage: exec.error || safePrev.errorMessage,
            executionState: exec.executionState,
            findingId: exec.findingId || safePrev.findingId,
            pendingQuestion:
              exec.pendingQuestion === undefined
                ? safePrev.pendingQuestion
                : exec.pendingQuestion,
            recentSteps: exec.steps || safePrev.recentSteps || [],
            runId: exec.runId || safePrev.runId,
            sequence: exec.sequence,
            status: isTerminal
              ? computedStatus
              : exec.executionState === "WAITING_FOR_USER"
                ? "waiting-for-user"
                : computedStatus || safePrev.status,
            verdict: exec.verdict || safePrev.verdict,
          };
        });
      }

      if (streamPart.type === "data-qa-finding") {
        const finding = streamPart.data;
        setMetadata((prev) => {
          const safePrev = prev ?? {};
          return {
            ...safePrev,
            executionState: "COMPLETED",
            finding,
            findingId: finding.findingId || safePrev.findingId,
            status: "idle",
            verdict: (finding.status as any) || safePrev.verdict,
          };
        });
      }

      if (streamPart.type === "data-qa-step") {
        const step = streamPart.data;
        setMetadata((prev) => {
          const safePrev = prev ?? {};
          if (
            (safePrev.executionState === "CANCELLED" ||
              safePrev.executionState === "CANCELLING") &&
            safePrev.status === "stopped"
          ) {
            return safePrev;
          }

          const recent = safePrev.recentSteps || [];
          const existingIdx =
            typeof step.number === "number"
              ? recent.findIndex((s) => s.number === step.number)
              : -1;

          let updatedSteps: typeof recent;
          if (existingIdx >= 0) {
            updatedSteps = [...recent];
            updatedSteps[existingIdx] = {
              ...updatedSteps[existingIdx],
              ...step,
            };
          } else {
            updatedSteps = [...recent, step];
          }

          return {
            ...safePrev,
            currentAction: step.action,
            currentUrl: step.url || safePrev.currentUrl,
            recentSteps: updatedSteps,
            status: "working",
          };
        });
      }

      if (streamPart.type === "data-qa-download") {
        const download = streamPart.data;
        setMetadata((prev) => {
          const safePrev = prev ?? {};
          const existing = safePrev.downloads || [];
          const idx = existing.findIndex(
            (d: any) => d.downloadId === download.downloadId
          );

          let updatedDownloads: any[];
          if (idx >= 0) {
            updatedDownloads = [...existing];
            updatedDownloads[idx] = { ...updatedDownloads[idx], ...download };
          } else {
            updatedDownloads = [...existing, download];
          }

          return {
            ...safePrev,
            downloads: updatedDownloads,
          };
        });
      }

      if (streamPart.type === "data-qa-clarification") {
        const question = streamPart.data;
        setMetadata((prev) => {
          const safePrev = prev ?? {};
          return {
            ...safePrev,
            executionState: "WAITING_FOR_USER",
            pendingQuestion: question,
            status: "waiting-for-user",
          };
        });
      }
    },
    toolbar: [],
  }
);
