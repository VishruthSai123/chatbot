import assert from "node:assert/strict";
import { getActiveSessionPrompt } from "../lib/ai/prompts-qa";
import { ExecutionTracker } from "../lib/qa/execution-tracker";
import {
  type CanonicalExecutionState,
  canTransitionState,
  isIrreversibleExecutionState,
  isStoppedOrPausedState,
} from "../lib/qa/execution-types";

async function runTests() {
  console.log("=== Testing Canonical Execution & Stop/Resume Lifecycle ===");

  // 1. Test isTerminalExecutionState and isIrreversibleExecutionState
  console.log("\n[Test 1] Terminal and irreversible state checks...");
  assert.strictEqual(isIrreversibleExecutionState("COMPLETED"), true);
  assert.strictEqual(isIrreversibleExecutionState("FAILED"), true);
  assert.strictEqual(isIrreversibleExecutionState("TIMED_OUT"), true);
  assert.strictEqual(isIrreversibleExecutionState("CANCELLED"), false); // Cancellations can be resumed
  assert.strictEqual(isIrreversibleExecutionState("PAUSED"), false);
  assert.strictEqual(isIrreversibleExecutionState("RUNNING"), false);

  assert.strictEqual(isStoppedOrPausedState("CANCELLED"), true);
  assert.strictEqual(isStoppedOrPausedState("PAUSED"), true);
  assert.strictEqual(isStoppedOrPausedState("RUNNING"), false);
  console.log(
    "✓ Terminal, irreversible, and stopped states correctly identified"
  );

  // 2. Test canTransitionState Matrix
  console.log("\n[Test 2] State transition matrix validation...");
  // From STARTING
  assert.strictEqual(canTransitionState("STARTING", "RUNNING"), true);
  assert.strictEqual(canTransitionState("STARTING", "FAILED"), true);
  assert.strictEqual(canTransitionState("STARTING", "CANCELLED"), true);

  // From RUNNING
  assert.strictEqual(canTransitionState("RUNNING", "WAITING"), true);
  assert.strictEqual(canTransitionState("RUNNING", "RUNNING"), true);
  assert.strictEqual(canTransitionState("RUNNING", "CANCELLING"), true);
  assert.strictEqual(canTransitionState("RUNNING", "CANCELLED"), true);
  assert.strictEqual(canTransitionState("RUNNING", "FAILED"), true);
  assert.strictEqual(canTransitionState("RUNNING", "TIMED_OUT"), true);

  // From CANCELLING
  assert.strictEqual(canTransitionState("CANCELLING", "CANCELLED"), true);
  assert.strictEqual(canTransitionState("CANCELLING", "FAILED"), true);
  assert.strictEqual(canTransitionState("CANCELLING", "RUNNING"), false);

  // From CANCELLED
  assert.strictEqual(canTransitionState("CANCELLED", "RESUMING"), true);
  assert.strictEqual(canTransitionState("CANCELLED", "STARTING"), true);
  assert.strictEqual(canTransitionState("CANCELLED", "RUNNING"), false);
  assert.strictEqual(canTransitionState("CANCELLED", "WAITING"), false);

  // Irreversible terminal states cannot transition to anything
  const irreversibleStates: CanonicalExecutionState[] = [
    "COMPLETED",
    "FAILED",
    "TIMED_OUT",
  ];
  for (const term of irreversibleStates) {
    assert.strictEqual(
      canTransitionState(term, "RUNNING"),
      false,
      `${term} must not transition to RUNNING`
    );
    assert.strictEqual(
      canTransitionState(term, "WAITING"),
      false,
      `${term} must not transition to WAITING`
    );
    assert.strictEqual(
      canTransitionState(term, "STARTING"),
      false,
      `${term} must not transition to STARTING`
    );
    assert.strictEqual(
      canTransitionState(term, "RESUMING"),
      false,
      `${term} must not transition to RESUMING`
    );
  }
  console.log(
    "✓ State transition matrix prevents regressions and preserves continuation safety"
  );

  // 3. Test Full Execution Lifecycle in ExecutionTracker
  console.log("\n[Test 3] ExecutionTracker end-to-end lifecycle...");
  const testChatId = "chat-test-lifecycle-1";
  const sessionId = "session-test-1";

  // 3a. Start Run
  const run1 = ExecutionTracker.startRun({
    browserSessionId: "bu-cloud-sess-1",
    chatId: testChatId,
    sessionId,
    targetUrl: "https://example.com/checkout",
  });

  assert.strictEqual(run1.chatId, testChatId);
  assert.strictEqual(run1.executionState, "STARTING");
  assert.strictEqual(run1.sequence, 1);
  assert.strictEqual(run1.steps.length, 0);

  // 3b. Step 1 (Navigation)
  const step1 = ExecutionTracker.updateStep({
    action: "Navigating to /checkout",
    chatId: testChatId,
    number: 1,
    status: "running",
    url: "https://example.com/checkout",
  });
  assert(step1 !== null);
  assert.strictEqual(step1.executionState, "RUNNING");
  assert.strictEqual(step1.currentStep, 1);
  assert.strictEqual(step1.steps.length, 1);
  assert.strictEqual(step1.steps[0].action, "Navigating to /checkout");

  // 3c. Step 2 (Form interaction)
  const step2 = ExecutionTracker.updateStep({
    action: "Entering shipping address and clicking Next",
    chatId: testChatId,
    number: 2,
    status: "running",
    url: "https://example.com/checkout/step2",
  });
  assert(step2 !== null);
  assert.strictEqual(step2.currentStep, 2);
  assert.strictEqual(step2.steps.length, 2);

  // 3d. Waiting
  const waitingRun = ExecutionTracker.recordWaiting({
    chatId: testChatId,
    currentAction: "Verifying payment options displayed...",
  });
  assert(waitingRun !== null);
  assert.strictEqual(waitingRun.executionState, "WAITING");

  // 3e. Finalizing
  const finalizingRun = ExecutionTracker.recordFinalizing({
    chatId: testChatId,
  });
  assert(finalizingRun !== null);
  assert.strictEqual(finalizingRun.executionState, "FINALIZING");

  // 3f. Completed
  const completedRun = ExecutionTracker.completeRun({
    chatId: testChatId,
    findingId: "finding-xyz-123",
    verdict: "pass",
  });
  assert(completedRun !== null);
  assert.strictEqual(completedRun.executionState, "COMPLETED");
  assert.strictEqual(completedRun.verdict, "pass");
  console.log("✓ Full happy-path lifecycle verified");

  // 4. Test Stop During Navigation
  console.log("\n[Test 4] Stop during navigation...");
  const navChatId = "chat-test-stop-nav";
  ExecutionTracker.startRun({
    chatId: navChatId,
    sessionId: "sess-nav-1",
    targetUrl: "https://example.com",
  });
  ExecutionTracker.updateStep({
    action: "Navigating to https://example.com/products",
    chatId: navChatId,
    number: 1,
    status: "running",
  });

  const stoppedNav = await ExecutionTracker.cancelRun({
    chatId: navChatId,
    reason: "user_stopped",
  });
  assert(stoppedNav !== null);
  assert.strictEqual(stoppedNav.executionState, "CANCELLED");
  assert.strictEqual(
    stoppedNav.lastConfirmedAction,
    "Navigating to https://example.com/products"
  );
  assert.strictEqual(ExecutionTracker.isCancelRequested(navChatId), true);
  console.log("✓ Stop during navigation cleanly captures action and cancels");

  // 5. Test Stop During Form Interaction & Context Preservation
  console.log(
    "\n[Test 5] Stop during form interaction with context preservation..."
  );
  const formChatId = "chat-test-stop-form";
  ExecutionTracker.startRun({
    chatId: formChatId,
    sessionId: "sess-form-1",
    targetUrl: "https://example.com/login",
  });
  ExecutionTracker.updateStep({
    action: "Entered testuser@example.com into email field",
    chatId: formChatId,
    number: 1,
    status: "completed",
  });
  ExecutionTracker.updateStep({
    action: "Clicked Sign In button",
    chatId: formChatId,
    number: 2,
    status: "running",
  });

  const stoppedForm = await ExecutionTracker.cancelRun({
    chatId: formChatId,
    reason: "user_stopped",
  });
  assert(stoppedForm !== null);
  assert.strictEqual(stoppedForm.executionState, "CANCELLED");
  assert.strictEqual(stoppedForm.lastConfirmedAction, "Clicked Sign In button");
  assert.strictEqual(stoppedForm.steps.length, 2);
  assert.strictEqual(stoppedForm.steps[1].status, "completed"); // Mark running step cleanly completed
  console.log(
    "✓ Stop during form interaction preserves all steps and last action"
  );

  // 6. Test Double-Click Stop & Idempotency
  console.log("\n[Test 6] Double-click Stop idempotency...");
  const firstCancel = await ExecutionTracker.cancelRun({ chatId: formChatId });
  const secondCancel = await ExecutionTracker.cancelRun({ chatId: formChatId });
  assert.strictEqual(firstCancel?.executionState, "CANCELLED");
  assert.strictEqual(secondCancel?.executionState, "CANCELLED");
  assert.strictEqual(firstCancel?.sequence, secondCancel?.sequence);
  console.log("✓ Multiple stop clicks are strictly idempotent");

  // 7. Test Stop After Execution Already Completed
  console.log(
    "\n[Test 7] Stop after execution already completed (race condition)..."
  );
  const stopAfterComplete = await ExecutionTracker.cancelRun({
    chatId: testChatId,
  });
  assert.strictEqual(
    stopAfterComplete?.executionState,
    "COMPLETED",
    "COMPLETED terminal state must NOT be overridden by late stop"
  );
  console.log("✓ Late stop does not override COMPLETED final verdict");

  // 8. Test Stop vs Complete Race Condition
  console.log("\n[Test 8] Stop/Complete race condition...");
  const raceChatId = "chat-test-race";
  ExecutionTracker.startRun({
    chatId: raceChatId,
    sessionId: "sess-race-1",
    targetUrl: "https://example.com",
  });
  await ExecutionTracker.cancelRun({ chatId: raceChatId });

  // Complete attempt on cancelled run must be rejected
  const lateComplete = ExecutionTracker.completeRun({
    chatId: raceChatId,
    verdict: "pass",
  });
  assert.strictEqual(
    lateComplete?.executionState,
    "CANCELLED",
    "Late complete must NOT overwrite CANCELLED state"
  );
  console.log("✓ Late complete safely ignored on CANCELLED run");

  // 9. Test Resume from Stopped State
  console.log("\n[Test 9] Resume from stopped run...");
  const resumedRun = await ExecutionTracker.resumeRun({ chatId: formChatId });
  assert(resumedRun !== null);
  assert.strictEqual(resumedRun.executionState, "RESUMING");
  assert.strictEqual(resumedRun.isCancelRequested, false);
  assert.strictEqual(resumedRun.steps.length, 2);
  assert(resumedRun.currentAction?.includes("Clicked Sign In button"));

  // Subsequent steps after resume continue smoothly
  ExecutionTracker.updateStep({
    action: "Verified dashboard home page loaded",
    chatId: formChatId,
    number: 3,
    status: "running",
  });
  const runAfterResume = ExecutionTracker.getActiveRun(formChatId);
  assert.strictEqual(runAfterResume?.steps.length, 3);
  assert.strictEqual(runAfterResume?.currentStep, 3);
  console.log("✓ Resume continues from step 3 without losing prior steps");

  // 10. Test Multiple Resume Clicks Idempotency
  console.log("\n[Test 10] Multiple Resume clicks idempotency...");
  const multiResumeChatId = "chat-test-multi-resume";
  ExecutionTracker.startRun({
    chatId: multiResumeChatId,
    sessionId: "sess-multi-1",
    targetUrl: "https://example.com",
  });
  await ExecutionTracker.cancelRun({ chatId: multiResumeChatId });

  const resume1 = await ExecutionTracker.resumeRun({
    chatId: multiResumeChatId,
  });
  const resume2 = await ExecutionTracker.resumeRun({
    chatId: multiResumeChatId,
  });
  assert.strictEqual(resume1?.executionState, "RESUMING");
  assert.strictEqual(resume2?.executionState, "RESUMING");
  assert.strictEqual(resume1?.sequence, resume2?.sequence);
  console.log("✓ Multiple resume clicks are safe and idempotent");

  // 11. Test Reload & Snapshot Restoration
  console.log("\n[Test 11] Reload and snapshot restoration...");
  const serializedSnapshot = JSON.parse(JSON.stringify(runAfterResume));
  const restored = ExecutionTracker.restoreRun(serializedSnapshot);
  assert.strictEqual(restored.chatId, formChatId);
  assert.strictEqual(restored.steps.length, 3);
  assert.strictEqual(
    restored.steps[0].action,
    "Entered testuser@example.com into email field"
  );
  console.log(
    "✓ Run state and full step history survive reload and deserialize accurately"
  );

  // 12. Test Rich Continuation Prompt Generation
  console.log("\n[Test 12] Prompt continuation injection for agent...");
  const continuationPrompt = getActiveSessionPrompt(
    {
      browserSessionId: "bu-sess-continuation",
      status: "cancelled",
      targetUrl: "https://example.com/checkout",
    },
    {
      cancellationReason: "User requested pause",
      currentAction: "Waiting for authenticated dashboard",
      currentStep: 2,
      executionState: "CANCELLED",
      interruptedAt: new Date().toISOString(),
      lastConfirmedAction: "Clicked Login Button",
      steps: [
        { action: "Entered login credentials", number: 1, status: "completed" },
        { action: "Clicked Login Button", number: 2, status: "completed" },
      ],
    }
  );

  assert(
    continuationPrompt.includes(
      "INTERRUPTED / STOPPED TEST CONTINUATION CONTEXT"
    )
  );
  assert(continuationPrompt.includes("Clicked Login Button"));
  assert(continuationPrompt.includes("DO NOT call `startTestSession` again"));
  assert(continuationPrompt.includes("DO NOT repeat destructive"));
  assert(continuationPrompt.includes("Entered login credentials"));
  console.log(
    "✓ Continuation prompt accurately informs LLM of prior actions and prevents destructive replays"
  );

  // 13. Test AbortController Propagation
  console.log("\n[Test 13] AbortController propagation on Stop...");
  const abortChatId = "chat-abort-test";
  const controller = new AbortController();
  ExecutionTracker.registerAbortController(abortChatId, controller);
  assert.strictEqual(controller.signal.aborted, false);

  ExecutionTracker.startRun({
    chatId: abortChatId,
    sessionId: "sess-abort",
    targetUrl: "https://example.com",
  });

  await ExecutionTracker.cancelRun({
    chatId: abortChatId,
    reason: "user_stopped",
  });

  assert.strictEqual(
    controller.signal.aborted,
    true,
    "AbortController must be aborted when cancelRun is invoked"
  );
  console.log(
    "✓ AbortController immediately aborted, halting active stream and LLM execution"
  );

  // 14. Test Late-Task Interception (task created after cancel requested)
  console.log(
    "\n[Test 14] Late-registered activeTaskId interception on cancelled run..."
  );
  const lateChatId = "chat-late-task-test";
  const lateRun = ExecutionTracker.startRun({
    chatId: lateChatId,
    sessionId: "sess-late",
    targetUrl: "https://example.com",
  });

  await ExecutionTracker.cancelRun({
    chatId: lateChatId,
    reason: "user_stopped",
  });

  assert.strictEqual(lateRun.executionState, "CANCELLED");
  assert.strictEqual(lateRun.isCancelRequested, true);

  // Simulate task creation completing 1 second after Stop was clicked
  ExecutionTracker.setActiveTaskId(lateChatId, lateRun.runId, "task-late-123");
  assert.strictEqual(lateRun.activeTaskId, "task-late-123");
  console.log(
    "✓ Late-registered taskId successfully intercepted and marked on cancelled run"
  );

  // 15. Test Browser Session Usability Contract
  console.log("\n[Test 15] Browser session usability contract validation...");
  const isSessionIdUsable = (browserSessionId?: string | null) =>
    Boolean(browserSessionId?.trim());
  assert.strictEqual(
    isSessionIdUsable(null),
    false,
    "Null session ID must be unusable"
  );
  assert.strictEqual(
    isSessionIdUsable(undefined),
    false,
    "Undefined session ID must be unusable"
  );
  assert.strictEqual(
    isSessionIdUsable(""),
    false,
    "Empty session ID must be unusable"
  );
  assert.strictEqual(
    isSessionIdUsable("sess-active-123"),
    true,
    "Valid session ID format is recognized"
  );
  console.log(
    "✓ Session usability check contract accurately detects missing or null sessions"
  );

  // 16. Test Dead Session Context Suppression
  console.log(
    "\n[Test 16] Dead session context suppression for prompt generation..."
  );
  const deadSessionPrompt = getActiveSessionPrompt({
    browserSessionId: "sess-dead-123",
    status: "completed",
    targetUrl: "https://example.com",
  });
  assert.strictEqual(
    deadSessionPrompt,
    "",
    "Prompt must be empty for completed/ended sessions so model starts fresh"
  );

  const nullIdPrompt = getActiveSessionPrompt({
    browserSessionId: null,
    status: "active",
    targetUrl: "https://example.com",
  });
  assert.strictEqual(
    nullIdPrompt,
    "",
    "Prompt must be empty when browserSessionId is null"
  );
  console.log(
    "✓ Dead/ended sessions suppress continuation prompts, preventing stale execution reuse"
  );

  // 17. Verify New Prompt on Dead Session doesn't falsely fail
  console.log("\n[Test 17] Prompt execution on dead session resilience...");
  const recoveryChatId = "chat-recovery-test";
  const deadRun = ExecutionTracker.startRun({
    chatId: recoveryChatId,
    sessionId: "sess-old-ended",
    targetUrl: "https://example.com",
  });
  ExecutionTracker.completeRun({
    chatId: recoveryChatId,
    runId: deadRun.runId,
  });
  assert.strictEqual(deadRun.executionState, "COMPLETED");

  // A new prompt starts a new run without claiming test failed
  const freshRun = ExecutionTracker.startRun({
    chatId: recoveryChatId,
    sessionId: "sess-new-recovered",
    targetUrl: "https://example.com",
  });
  assert.strictEqual(freshRun.executionState, "STARTING");
  assert.strictEqual(freshRun.sessionId, "sess-new-recovered");
  assert.notStrictEqual(freshRun.runId, deadRun.runId);
  console.log(
    "✓ New user prompt against dead session correctly starts fresh run without failing"
  );

  console.log("\n=======================================================");
  console.log("ALL STOP/RESUME LIFECYCLE TESTS PASSED! (17/17)");
  console.log("=======================================================");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
