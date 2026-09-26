import { Artifact } from "@/components/chat/create-artifact";
import {
  type BrowserArtifactMetadata,
  BrowserPreview,
} from "@/components/qa/browser-preview";

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
          browserSessionId: session.browserSessionId,
          liveUrl: session.liveUrl,
          sessionId: session.id,
          status: (session.status as any) || "live",
          targetUrl: session.targetUrl,
        }));

        setArtifact((draftArtifact) => ({
          ...draftArtifact,
          isVisible: true,
          kind: "browser",
          status: "streaming",
          title: session.targetUrl || "Live Browser",
        }));
      }

      if (streamPart.type === "data-qa-step") {
        const step = streamPart.data;
        setMetadata((prev) => {
          const recent = prev?.recentSteps || [];
          return {
            ...prev,
            currentAction: step.action,
            currentUrl: step.url || prev?.currentUrl,
            recentSteps: [...recent, step],
            status: "working",
          };
        });
      }

      if (streamPart.type === "data-qa-status") {
        const statusText = streamPart.data;
        setMetadata((prev) => ({
          ...prev,
          currentAction: statusText,
          status: "working",
        }));
      }
    },
    toolbar: [],
  }
);
