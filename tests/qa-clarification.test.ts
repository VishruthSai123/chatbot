import assert from "node:assert/strict";
import { getActiveSessionPrompt } from "../lib/ai/prompts-qa";
import { ExecutionTracker } from "../lib/qa/execution-tracker";
import {
  type ClarificationQuestion,
  canTransitionState,
  isWaitingForUserState,
} from "../lib/qa/execution-types";

async function runClarificationTests() {
  console.log("=== Testing Human-in-the-Loop Clarification Suite ===");

  const chatId = "test-chat-clarification-suite";
  const sessionId = "session-clarification-1";
  const browserSessionId = "bu-cloud-sess-clarification";

  // Scenario 1: State transitions for WAITING_FOR_USER
  console.log("\n[Test 1] WAITING_FOR_USER state transition validation...");
  assert.strictEqual(canTransitionState("RUNNING", "WAITING_FOR_USER"), true);
  assert.strictEqual(canTransitionState("WAITING", "WAITING_FOR_USER"), true);
  assert.strictEqual(canTransitionState("STARTING", "WAITING_FOR_USER"), true);
  assert.strictEqual(canTransitionState("WAITING_FOR_USER", "RUNNING"), true);
  assert.strictEqual(canTransitionState("WAITING_FOR_USER", "RESUMING"), true);
  assert.strictEqual(
    canTransitionState("WAITING_FOR_USER", "CANCELLING"),
    true
  );
  assert.strictEqual(canTransitionState("WAITING_FOR_USER", "CANCELLED"), true);
  assert.strictEqual(canTransitionState("WAITING_FOR_USER", "FAILED"), true);
  assert.strictEqual(isWaitingForUserState("WAITING_FOR_USER"), true);
  assert.strictEqual(isWaitingForUserState("RUNNING"), false);
  console.log("✓ State transition matrix correctly supports WAITING_FOR_USER");

  // Scenario 2: Start run and record WAITING_FOR_USER (Choice - Movie Booking)
  console.log("\n[Test 2] Scenario A: Movie Booking (Choice)...");
  const run1 = ExecutionTracker.startRun({
    browserSessionId,
    chatId,
    sessionId,
    targetUrl: "https://cinema.example.com",
  });
  assert.strictEqual(run1.executionState, "STARTING");

  ExecutionTracker.updateStep({
    action: "Navigate to Movie details",
    chatId,
    number: 1,
    status: "completed",
  });
  ExecutionTracker.updateStep({
    action: "Select showtime 7:00 PM",
    chatId,
    number: 2,
    status: "completed",
  });

  const movieQuestion: ClarificationQuestion = {
    agentContext: "Seat selection page",
    askedAt: new Date().toISOString(),
    inputType: "choice",
    isAnswered: false,
    options: ["1", "2", "3", "4"],
    question: "How many seats would you like?",
    questionId: "q-movie-seats-1",
    questionText: "How many seats would you like?",
    questionType: "choice",
    required: true,
    runId: run1.runId,
    type: "USER_INPUT_REQUIRED",
  };

  const waitingRun = ExecutionTracker.recordWaitingForUser({
    chatId,
    question: movieQuestion,
    runId: run1.runId,
  });

  assert.ok(waitingRun);
  assert.strictEqual(waitingRun.executionState, "WAITING_FOR_USER");
  assert.strictEqual(waitingRun.pendingQuestion?.questionId, "q-movie-seats-1");
  assert.strictEqual(waitingRun.pendingQuestion?.isAnswered, false);
  console.log(
    "✓ Agent transitioned to WAITING_FOR_USER with structured question data"
  );

  // Scenario 3: User answers choice (3 seats)
  console.log(
    "\n[Test 3] User answers question (3 seats) and resumes execution..."
  );
  const answeredRun = ExecutionTracker.resumeWithAnswer({
    answer: "3",
    chatId,
    questionId: "q-movie-seats-1",
    runId: run1.runId,
  });

  assert.ok(answeredRun);
  assert.strictEqual(answeredRun.executionState, "RESUMING");
  assert.strictEqual(answeredRun.runId, run1.runId); // Preserved same runId
  assert.strictEqual(answeredRun.pendingQuestion, null); // Pending cleared
  assert.strictEqual(answeredRun.clarificationHistory?.length, 1);
  assert.strictEqual(answeredRun.clarificationHistory[0].answer, "3");
  assert.strictEqual(answeredRun.clarificationHistory[0].isAnswered, true);
  console.log(
    "✓ Same run preserved, answer recorded in history, state set to RESUMING"
  );

  // Scenario 4: Duplicate answer protection (Scenario H)
  console.log("\n[Test 4] Scenario H: Duplicate answer protection...");
  const dupRun = ExecutionTracker.resumeWithAnswer({
    answer: "3",
    chatId,
    questionId: "q-movie-seats-1",
    runId: run1.runId,
  });
  assert.strictEqual(dupRun?.clarificationHistory?.length, 1); // Not duplicated
  console.log("✓ Duplicate answer submission safely rejected / idempotent");

  // Scenario 5: Context Injection into prompt (Scenario 8)
  console.log(
    "\n[Test 5] Scenario 8: Prompt context injection for answered questions..."
  );
  const prompt = getActiveSessionPrompt(
    {
      browserSessionId,
      status: "active",
      targetUrl: "https://cinema.example.com",
    },
    answeredRun
  );
  assert.ok(
    prompt.includes("USER CLARIFICATIONS & REQUIRED INFORMATION PROVIDED")
  );
  assert.ok(prompt.includes('Question: "How many seats would you like?"'));
  assert.ok(prompt.includes('User Answer: "3"'));
  assert.ok(prompt.includes("DO NOT ask the user for this information again"));
  console.log(
    "✓ Structured clarification context injected into prompt for agent continuation"
  );

  // Scenario 6: Scenario B: Missing address (Text input)
  console.log("\n[Test 6] Scenario B: Missing address (Text input)...");
  const addressQuestion: ClarificationQuestion = {
    agentContext: "Checkout shipping form",
    askedAt: new Date().toISOString(),
    inputType: "text",
    isAnswered: false,
    placeholder: "e.g. 123 Main St, Springfield",
    question:
      "I need a delivery address to continue. What address should I use?",
    questionId: "q-address-2",
    questionText:
      "I need a delivery address to continue. What address should I use?",
    questionType: "text",
    required: true,
    runId: run1.runId,
    type: "USER_INPUT_REQUIRED",
  };

  ExecutionTracker.recordWaitingForUser({
    chatId,
    question: addressQuestion,
    runId: run1.runId,
  });

  const activeBeforeAnswer = ExecutionTracker.getActiveRun(chatId);
  assert.strictEqual(activeBeforeAnswer?.executionState, "WAITING_FOR_USER");
  assert.strictEqual(
    activeBeforeAnswer?.pendingQuestion?.questionId,
    "q-address-2"
  );

  ExecutionTracker.resumeWithAnswer({
    answer: "123 Main Street, Apt 4B",
    chatId,
    questionId: "q-address-2",
    runId: run1.runId,
  });

  const activeAfterAnswer = ExecutionTracker.getActiveRun(chatId);
  assert.strictEqual(activeAfterAnswer?.clarificationHistory?.length, 2);
  assert.strictEqual(
    activeAfterAnswer?.clarificationHistory[1].answer,
    "123 Main Street, Apt 4B"
  );
  console.log("✓ Text input clarification handled and accumulated in context");

  // Scenario 7: Scenario D: Confirmation (Yes/No or Continue/Cancel)
  console.log("\n[Test 7] Scenario D: Confirmation input...");
  const confirmQuestion: ClarificationQuestion = {
    agentContext: "Final order placement",
    askedAt: new Date().toISOString(),
    inputType: "confirm",
    isAnswered: false,
    options: ["Continue", "Cancel"],
    question: "This action will place the order. Do you want me to continue?",
    questionId: "q-confirm-3",
    questionText:
      "This action will place the order. Do you want me to continue?",
    questionType: "confirm",
    required: true,
    runId: run1.runId,
    type: "USER_INPUT_REQUIRED",
  };

  ExecutionTracker.recordWaitingForUser({
    chatId,
    question: confirmQuestion,
    runId: run1.runId,
  });

  const activeConfirm = ExecutionTracker.getActiveRun(chatId);
  assert.strictEqual(activeConfirm?.executionState, "WAITING_FOR_USER");
  assert.strictEqual(activeConfirm?.pendingQuestion?.questionType, "confirm");
  console.log("✓ Confirmation question correctly recorded");

  // Scenario 8: Scenario G: Stop while waiting
  console.log("\n[Test 8] Scenario G: Stop while waiting for user...");
  const stoppedRun = await ExecutionTracker.cancelRun({
    chatId,
    reason: "user_stopped",
    runId: run1.runId,
  });

  assert.ok(stoppedRun);
  assert.strictEqual(stoppedRun.executionState, "CANCELLED");
  assert.strictEqual(stoppedRun.pendingQuestion, null); // Question cleared!
  console.log(
    "✓ Stop while waiting transitions to CANCELLED and clears pending question"
  );

  // Scenario 9: Scenario E: Reload while waiting & snapshot recovery
  console.log(
    "\n[Test 9] Scenario E: Reload while waiting snapshot restoration..."
  );
  const reloadChatId = "chat-reload-test";
  const reloadRun = ExecutionTracker.startRun({
    browserSessionId: "bu-reload-sess",
    chatId: reloadChatId,
    sessionId: "sess-reload",
    targetUrl: "https://shop.example.com",
  });

  const reloadQuestion: ClarificationQuestion = {
    askedAt: new Date().toISOString(),
    inputType: "choice",
    isAnswered: false,
    options: ["Red", "Blue", "Black"],
    question: "Which color would you prefer?",
    questionId: "q-color-reload",
    questionText: "Which color would you prefer?",
    questionType: "choice",
    required: true,
    runId: reloadRun.runId,
    type: "USER_INPUT_REQUIRED",
  };

  ExecutionTracker.recordWaitingForUser({
    chatId: reloadChatId,
    question: reloadQuestion,
    runId: reloadRun.runId,
  });

  // Snapshot is saved. Now simulate page reload by restoring snapshot:
  const snapshotData = JSON.parse(JSON.stringify(reloadRun));
  const restored = ExecutionTracker.restoreRun(snapshotData);

  assert.strictEqual(restored.executionState, "WAITING_FOR_USER");
  assert.strictEqual(restored.pendingQuestion?.questionId, "q-color-reload");
  assert.strictEqual(restored.pendingQuestion?.isAnswered, false);
  assert.deepStrictEqual(restored.pendingQuestion?.options, [
    "Red",
    "Blue",
    "Black",
  ]);
  console.log(
    "✓ WAITING_FOR_USER state and pending question accurately restored on reload"
  );

  // Scenario 10: Scenario I: Browser session ends while waiting (reconciliation safety)
  console.log(
    "\n[Test 10] Scenario I: Session reconciliation while WAITING_FOR_USER..."
  );
  const reconciled = await ExecutionTracker.reconcileRun(reloadChatId);
  assert.ok(reconciled);
  assert.strictEqual(reconciled.executionState, "WAITING_FOR_USER");
  assert.strictEqual(reconciled.pendingQuestion?.questionId, "q-color-reload");
  console.log(
    "✓ Reconcile preserves WAITING_FOR_USER without prematurely marking COMPLETED/FAILED"
  );

  // Scenario 11: ExecutionGuard: completeRun is strictly blocked during WAITING_FOR_USER
  console.log(
    "\n[Test 11] ExecutionGuard: completeRun blocked during WAITING_FOR_USER..."
  );
  const guardChatId = "chat-guard-test";
  const guardRun = ExecutionTracker.startRun({
    browserSessionId: "bu-guard-sess",
    chatId: guardChatId,
    sessionId: "sess-guard",
    targetUrl: "https://guard.example.com",
  });

  const guardQuestion: ClarificationQuestion = {
    askedAt: new Date().toISOString(),
    inputType: "confirm",
    isAnswered: false,
    options: ["Continue", "Cancel"],
    question: "Do you confirm?",
    questionId: "q-guard-1",
    questionText: "Do you confirm?",
    questionType: "confirm",
    required: true,
    runId: guardRun.runId,
    type: "USER_INPUT_REQUIRED",
  };

  ExecutionTracker.recordWaitingForUser({
    chatId: guardChatId,
    question: guardQuestion,
    runId: guardRun.runId,
  });

  const attemptedComplete = ExecutionTracker.completeRun({
    chatId: guardChatId,
    findingId: "f-123",
    verdict: "pass",
  });
  assert.strictEqual(attemptedComplete?.executionState, "WAITING_FOR_USER");
  assert.strictEqual(
    attemptedComplete?.pendingQuestion?.questionId,
    "q-guard-1"
  );
  console.log("✓ completeRun strictly blocked while WAITING_FOR_USER");

  // Scenario 12: ExecutionGuard: recordFinalizing is strictly blocked during WAITING_FOR_USER
  console.log(
    "\n[Test 12] ExecutionGuard: recordFinalizing blocked during WAITING_FOR_USER..."
  );
  const attemptedFinalizing = ExecutionTracker.recordFinalizing({
    chatId: guardChatId,
  });
  assert.strictEqual(attemptedFinalizing?.executionState, "WAITING_FOR_USER");
  assert.strictEqual(
    attemptedFinalizing?.pendingQuestion?.questionId,
    "q-guard-1"
  );
  console.log("✓ recordFinalizing strictly blocked while WAITING_FOR_USER");

  // Scenario 13: Inactivity (> 120s) must NEVER mark WAITING_FOR_USER as COMPLETED
  console.log(
    "\n[Test 13] Inactivity > 120s preserves WAITING_FOR_USER indefinitely..."
  );
  // Artificially age the run to 10 minutes ago
  guardRun.lastActivityAt = new Date(Date.now() - 600_000).toISOString();
  guardRun.startedAt = new Date(Date.now() - 600_000).toISOString();
  const inactiveReconcile = await ExecutionTracker.reconcileRun(guardChatId);
  assert.strictEqual(inactiveReconcile?.executionState, "WAITING_FOR_USER");
  assert.strictEqual(
    inactiveReconcile?.pendingQuestion?.questionId,
    "q-guard-1"
  );
  console.log("✓ Stale activity check preserves WAITING_FOR_USER indefinitely");

  // Scenario 14: Stale question ID answer rejected with REJECTED_STALE
  console.log("\n[Test 14] Stale question ID answer rejected...");
  const staleAnswer = ExecutionTracker.resumeWithAnswer({
    answer: "Yes",
    chatId: guardChatId,
    questionId: "q-non-existent-or-stale",
  });
  assert.strictEqual(staleAnswer, null);
  assert.strictEqual(guardRun.executionState, "WAITING_FOR_USER");
  assert.strictEqual(guardRun.pendingQuestion?.questionId, "q-guard-1");
  console.log("✓ Stale question ID answer safely rejected");

  // Scenario 15: Prematurely completed run rescued to WAITING_FOR_USER
  console.log(
    "\n[Test 15] Prematurely completed run rescued for active clarification..."
  );
  const rescueChatId = "chat-rescue-test";
  const rescueRun = ExecutionTracker.startRun({
    browserSessionId: "bu-rescue-sess",
    chatId: rescueChatId,
    sessionId: "sess-rescue",
    targetUrl: "https://rescue.example.com",
  });
  // Simulate premature completion from background glitch
  rescueRun.executionState = "COMPLETED";

  const rescueQuestion: ClarificationQuestion = {
    askedAt: new Date().toISOString(),
    inputType: "text",
    isAnswered: false,
    question: "Enter your PIN",
    questionId: "q-pin-rescue",
    questionText: "Enter your PIN",
    questionType: "text",
    required: true,
    runId: rescueRun.runId,
    type: "USER_INPUT_REQUIRED",
  };

  const rescuedRun = ExecutionTracker.recordWaitingForUser({
    chatId: rescueChatId,
    question: rescueQuestion,
    runId: rescueRun.runId,
  });

  assert.ok(rescuedRun);
  assert.strictEqual(rescuedRun.executionState, "WAITING_FOR_USER");
  assert.strictEqual(rescuedRun.pendingQuestion?.questionId, "q-pin-rescue");
  console.log("✓ Prematurely completed run safely rescued to WAITING_FOR_USER");

  console.log("\n=======================================================");
  console.log("ALL HUMAN-IN-THE-LOOP CLARIFICATION TESTS PASSED! (15/15)");
  console.log("=======================================================\n");
}

runClarificationTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
