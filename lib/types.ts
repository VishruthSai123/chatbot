import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { createDocument } from "./ai/tools/create-document";
import type { evaluateTestResult } from "./ai/tools/evaluate-test-result";
import type { getWeather } from "./ai/tools/get-weather";
import type { requestSuggestions } from "./ai/tools/request-suggestions";
import type { runBrowserStep } from "./ai/tools/run-browser-step";
import type { startTestSession } from "./ai/tools/start-test-session";
import type { updateDocument } from "./ai/tools/update-document";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;

type startTestSessionTool = InferUITool<ReturnType<typeof startTestSession>>;
type runBrowserStepTool = InferUITool<ReturnType<typeof runBrowserStep>>;
type evaluateTestResultTool = InferUITool<
  ReturnType<typeof evaluateTestResult>
>;

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  startTestSession: startTestSessionTool;
  runBrowserStep: runBrowserStepTool;
  evaluateTestResult: evaluateTestResultTool;
};

export type WaitingStatusData = {
  phase: "waiting" | "still-waiting" | "health" | "thinking";
  message: string;
  modelId: string;
  modelName: string;
};

export type BrowserSessionStreamData = {
  id?: string;
  browserSessionId: string;
  liveUrl: string;
  targetUrl: string;
  status?: string;
};

export type QAStepStreamData = {
  number?: number;
  action: string;
  goal?: string;
  url?: string;
  status?: "running" | "completed" | "failed";
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
  "waiting-status": WaitingStatusData;
  "browser-session": BrowserSessionStreamData;
  "qa-step": QAStepStreamData;
  "qa-status": string;
  "qa-finding": {
    status: string;
    title: string;
    summary: string;
    expected?: string;
    actual?: string;
    reproductionSteps?: string[];
    evidence?: Array<{ type: string; value: string; description?: string }>;
    severity?: string;
    findingId?: string | null;
  };
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
