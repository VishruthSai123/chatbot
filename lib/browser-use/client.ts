import { BrowserUse } from "browser-use-sdk";

let browserUseClient: BrowserUse | null = null;

export function getBrowserUseClient(): BrowserUse {
  if (browserUseClient) {
    return browserUseClient;
  }
  const apiKey = process.env.BROWSER_USE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BROWSER_USE_API_KEY is not defined. Please set it in .env.local"
    );
  }
  browserUseClient = new BrowserUse({ apiKey });
  return browserUseClient;
}

export type {
  BrowserSessionStatus,
  SessionItemView,
  SessionView,
  TaskResult,
  TaskStepView,
  TaskView,
} from "browser-use-sdk";
