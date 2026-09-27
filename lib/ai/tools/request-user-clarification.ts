import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { ExecutionTracker } from "@/lib/qa/execution-tracker";
import type { ClarificationQuestion } from "@/lib/qa/execution-types";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type RequestUserClarificationProps = {
  chatId: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

/**
 * AI tool: requestUserClarification
 *
 * Pauses the current browser execution and asks the user a question.
 * The agent calls this tool when it encounters a decision point, missing information,
 * or ambiguity during a browser test execution.
 *
 * The tool:
 * 1. Transitions the execution state to WAITING_FOR_USER
 * 2. Streams the question to the UI via data-qa-clarification
 * 3. Returns immediately with a placeholder — the actual answer will be
 *    injected back via the /api/qa/clarification endpoint and the LLM
 *    will be re-invoked with the answer in context.
 */
export const requestUserClarification = ({
  chatId,
  dataStream,
}: RequestUserClarificationProps) =>
  tool({
    description:
      "Pause the current browser test execution and ask the user a clarification question. Use this when you encounter a genuinely required decision, missing information, ambiguity, or an important user-dependent step during browser execution. For example: seat selection, address input, payment confirmation, date/time choice, or any field where you cannot reasonably guess the right value. The execution will pause until the user responds, then resume in the same browser session.",
    execute: async ({ questionType, questionText, options, placeholder }) => {
      const activeRun = ExecutionTracker.getActiveRun(chatId);

      if (!activeRun) {
        return {
          error: "No active execution to pause for clarification.",
          success: false,
        };
      }

      // Don't ask questions if already cancelled
      if (ExecutionTracker.isCancelRequested(chatId)) {
        return {
          error: "Execution was stopped by user.",
          isStopped: true,
          success: false,
        };
      }

      const questionId = generateUUID();
      const now = new Date().toISOString();
      const normalizedType =
        questionType === "confirmation" ? "confirm" : questionType;

      const question: ClarificationQuestion = {
        agentContext: activeRun.currentAction || undefined,
        askedAt: now,
        inputType: normalizedType,
        isAnswered: false,
        options:
          normalizedType === "choice" && options?.length
            ? options
            : normalizedType === "confirm"
              ? options?.length
                ? options
                : ["Continue", "Cancel"]
              : undefined,
        placeholder: placeholder || undefined,
        question: questionText,
        questionId,
        questionText,
        questionType: normalizedType,
        required: true,
        runId: activeRun.runId,
        type: "USER_INPUT_REQUIRED",
      };

      // Transition execution state to WAITING_FOR_USER
      const updatedRun = ExecutionTracker.recordWaitingForUser({
        chatId,
        question,
        runId: activeRun.runId,
      });

      if (updatedRun?.executionState !== "WAITING_FOR_USER") {
        return {
          error: "Failed to transition to WAITING_FOR_USER state.",
          success: false,
        };
      }

      // Stream the clarification question to the UI
      dataStream.write({
        data: question,
        transient: false,
        type: "data-qa-clarification",
      });

      // Stream execution state update
      dataStream.write({
        data: {
          currentAction: updatedRun.currentAction,
          currentStep: updatedRun.currentStep,
          executionState: "WAITING_FOR_USER",
          lastActivityAt: updatedRun.lastActivityAt,
          pendingQuestion: question,
          runId: updatedRun.runId,
          sequence: updatedRun.sequence,
          sessionId: updatedRun.sessionId,
          startedAt: updatedRun.startedAt,
          steps: updatedRun.steps,
        },
        transient: true,
        type: "data-qa-execution",
      });

      // Stream status update
      dataStream.write({
        data: `Waiting for your input: ${questionText}`,
        transient: true,
        type: "data-qa-status",
      });

      // Now we need to wait for the user's answer.
      // We poll the execution tracker for the answer, with a timeout.
      const POLL_INTERVAL_MS = 500;
      const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes max wait
      const startWait = Date.now();

      while (Date.now() - startWait < MAX_WAIT_MS) {
        // Check if cancelled
        if (ExecutionTracker.isCancelRequested(chatId)) {
          return {
            answer: null,
            isStopped: true,
            questionId,
            questionText,
            success: false,
          };
        }

        // Check if the question has been answered
        const currentRun = ExecutionTracker.getActiveRun(chatId);
        if (!currentRun) {
          return {
            answer: null,
            error: "Execution was lost while waiting for user input.",
            questionId,
            questionText,
            success: false,
          };
        }

        // Check clarification history for our answered question
        const answeredQ = currentRun.clarificationHistory?.find(
          (q) => q.questionId === questionId && q.isAnswered
        );

        if (answeredQ?.answer) {
          // User answered! Return the answer so the LLM can use it.
          return {
            answer: answeredQ.answer,
            questionId,
            questionText,
            success: true,
          };
        }

        // Keep heartbeat alive
        if ((Date.now() - startWait) % 15_000 < POLL_INTERVAL_MS) {
          dataStream.write({
            data: `Still waiting for your answer to: "${questionText.slice(0, 80)}"`,
            transient: true,
            type: "data-qa-status",
          });
        }

        // biome-ignore lint/performance/noAwaitInLoops: intentional polling interval waiting for user response
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Timed out waiting for user
      return {
        answer: null,
        error: "Timed out waiting for user clarification after 10 minutes.",
        questionId,
        questionText,
        success: false,
      };
    },
    inputSchema: z.object({
      options: z
        .array(z.string())
        .optional()
        .describe(
          "For 'choice' type: the list of options the user can pick from. For 'confirm' / 'confirmation' type: optional confirmation options (defaults to ['Continue', 'Cancel']). Not needed for 'text' or 'number' type."
        ),
      placeholder: z
        .string()
        .optional()
        .describe(
          "Optional placeholder text for the input field (for 'text' or 'number' types)."
        ),
      questionText: z
        .string()
        .describe(
          "The question to ask the user. Be clear and concise. Example: 'How many seats would you like?' or 'What delivery address should I use?'"
        ),
      questionType: z
        .enum(["choice", "text", "number", "confirm", "confirmation"])
        .describe(
          "The type of clarification needed: 'choice' for picking from options, 'text' for free-form input, 'number' for numeric input, 'confirm'/'confirmation' for confirmation actions."
        ),
    }),
  });
