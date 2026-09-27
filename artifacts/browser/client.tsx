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
        setMetadata((prev) => {
          if (isTerminalExecutionState(prev?.executionState)) {
            return prev;
          }
          return {
            ...prev,
            currentAction:
              typeof streamPart.data === "string"
                ? streamPart.data
                : prev?.currentAction,
          };
        });
      }

      if (streamPart.type === "data-qa-execution") {
        const exec = streamPart.data;
        setMetadata((prev) => {
          // If currently CANCELLED or CANCELLING, do NOT allow regression to RUNNING, WAITING, FINALIZING, or COMPLETED
          if (
            (prev?.executionState === "CANCELLED" ||
              prev?.executionState === "CANCELLING") &&
            exec.executionState !== "CANCELLED"
          ) {
            return prev;
          }

          // Terminal state protection: terminal states can NEVER be regressed
          if (
            isTerminalExecutionState(prev?.executionState) &&
            !isTerminalExecutionState(exec.executionState)
          ) {
            return prev;
          }

          // Monotonic sequence check: ignore stale packets from earlier steps
          if (
            prev?.sequence &&
            exec.sequence &&
            exec.sequence < prev.sequence
          ) {
            return prev;
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
            ...prev,
            currentAction: exec.currentAction || prev?.currentAction,
            errorMessage: exec.error || prev?.errorMessage,
            executionState: exec.executionState,
            findingId: exec.findingId || prev?.findingId,
            recentSteps: exec.steps || prev?.recentSteps || [],
            runId: exec.runId || prev?.runId,
            sequence: exec.sequence,
            status: isTerminal
              ? computedStatus
              : computedStatus || prev?.status,
            verdict: exec.verdict || prev?.verdict,
          };
        });
      }

      if (streamPart.type === "data-qa-step") {
        const step = streamPart.data;
        setMetadata((prev) => {
          if (isTerminalExecutionState(prev?.executionState)) {
            return prev;
          }

          const recent = prev?.recentSteps || [];
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
            ...prev,
            currentAction: step.action,
            currentUrl: step.url || prev?.currentUrl,
            recentSteps: updatedSteps,
            status: "working",
          };
        });
      }

      if (streamPart.type === "data-qa-status") {
        const statusText = streamPart.data;
        setMetadata((prev) => {
          if (isTerminalExecutionState(prev?.executionState)) {
            return prev;
          }
          return {
            ...prev,
            currentAction: statusText,
            status: "working",
          };
        });
      }
    },
    toolbar: [],
  }
);
