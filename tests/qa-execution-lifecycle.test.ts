import assert from "node:assert/strict";
import { ExecutionTracker } from "../lib/qa/execution-tracker";
import {
  type CanonicalExecutionState,
  canTransitionState,
  isTerminalExecutionState,
} from "../lib/qa/execution-types";

async function runTests() {
  console.log("=== Testing Canonical Execution Lifecycle ===");

  // 1. Test isTerminalExecutionState
  console.log("\n[Test 1] Terminal state checks...");
  assert.strictEqual(isTerminalExecutionState("COMPLETED"), true);
  assert.strictEqual(isTerminalExecutionState("FAILED"), true);
  assert.strictEqual(isTerminalExecutionState("CANCELLED"), true);
  assert.strictEqual(isTerminalExecutionState("TIMED_OUT"), true);
  assert.strictEqual(isTerminalExecutionState("RUNNING"), false);
  assert.strictEqual(isTerminalExecutionState("WAITING"), false);
  assert.strictEqual(isTerminalExecutionState("STARTING"), false);
  assert.strictEqual(isTerminalExecutionState("FINALIZING"), false);
  console.log("✓ Terminal states correctly identified");

  // 2. Test canTransitionState Matrix
  console.log("\n[Test 2] State transition matrix validation...");
  // From STARTING
  assert.strictEqual(canTransitionState("STARTING", "RUNNING"), true);
  assert.strictEqual(canTransitionState("STARTING", "FAILED"), true);
  assert.strictEqual(canTransitionState("STARTING", "CANCELLED"), true);

  // From RUNNING
  assert.strictEqual(canTransitionState("RUNNING", "WAITING"), true);
  assert.strictEqual(canTransitionState("RUNNING", "RUNNING"), true);
  assert.strictEqual(canTransitionState("RUNNING", "FAILED"), true);
  assert.strictEqual(canTransitionState("RUNNING", "TIMED_OUT"), true);

  // From FINALIZING
  assert.strictEqual(canTransitionState("FINALIZING", "COMPLETED"), true);
  assert.strictEqual(canTransitionState("FINALIZING", "FAILED"), true);
  assert.strictEqual(
    canTransitionState("FINALIZING", "RUNNING"),
    false,
    "Cannot regress from FINALIZING to RUNNING"
  );
  assert.strictEqual(
    canTransitionState("FINALIZING", "WAITING"),
    false,
    "Cannot regress from FINALIZING to WAITING"
  );

  // Terminal states cannot transition to anything
  const terminalStates: CanonicalExecutionState[] = [
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
  ];
  for (const term of terminalStates) {
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
      canTransitionState(term, "COMPLETED"),
      false,
      `${term} must not transition to COMPLETED`
    );
  }
  console.log(
    "✓ State transition matrix prevents regressions and preserves terminal finality"
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

  // 3b. Step 1: Navigating
  const step1 = ExecutionTracker.updateStep({
    action: "Navigate to https://example.com/checkout",
    chatId: testChatId,
    number: 1,
    status: "running",
    url: "https://example.com/checkout",
  });
  assert(step1 !== null);
  assert.strictEqual(step1.executionState, "RUNNING");
  assert.strictEqual(step1.currentStep, 1);
  assert.strictEqual(step1.sequence, 2);
  assert.strictEqual(step1.steps.length, 1);
  assert.strictEqual(
    step1.steps[0].action,
    "Navigate to https://example.com/checkout"
  );

  // 3c. Step 2: Clicking button
  const step2 = ExecutionTracker.updateStep({
    action: "Click 'Place Order' button",
    chatId: testChatId,
    number: 2,
    status: "running",
  });
  assert(step2 !== null);
  assert.strictEqual(step2.currentStep, 2);
  assert.strictEqual(step2.sequence, 3);
  assert.strictEqual(step2.steps.length, 2);

  // 3d. Transition to WAITING (tool step completed, awaiting assertion)
  const waitingRun = ExecutionTracker.recordWaiting({
    chatId: testChatId,
    currentAction: "Browser action completed. Analyzing outcome...",
  });
  assert(waitingRun !== null);
  assert.strictEqual(waitingRun.executionState, "WAITING");
  assert.strictEqual(waitingRun.sequence, 4);

  // 3e. Transition to FINALIZING (evaluating assertions)
  const finalizingRun = ExecutionTracker.recordFinalizing({
    chatId: testChatId,
  });
  assert(finalizingRun !== null);
  assert.strictEqual(finalizingRun.executionState, "FINALIZING");
  assert.strictEqual(finalizingRun.sequence, 5);

  // 3f. Complete Run
  const completedRun = ExecutionTracker.completeRun({
    chatId: testChatId,
    findingId: "finding-xyz-123",
    verdict: "pass",
  });
  assert(completedRun !== null);
  assert.strictEqual(completedRun.executionState, "COMPLETED");
  assert.strictEqual(completedRun.verdict, "pass");
  assert.strictEqual(completedRun.findingId, "finding-xyz-123");
  assert(Boolean(completedRun.completedAt));
  assert.strictEqual(completedRun.sequence, 6);
  console.log(
    "✓ Full happy-path lifecycle (STARTING -> RUNNING -> WAITING -> FINALIZING -> COMPLETED) verified"
  );

  // 4. Test Stale Event Rejection after Completion
  console.log("\n[Test 4] Stale event protection after COMPLETED...");
  // Attempting to inject a late RUNNING step after completion
  const staleStep = ExecutionTracker.updateStep({
    action: "Late delayed browser event",
    chatId: testChatId,
    number: 3,
    status: "running",
  });
  assert(staleStep !== null);
  assert.strictEqual(
    staleStep.executionState,
    "COMPLETED",
    "Late step must NOT regress COMPLETED state"
  );
  assert.strictEqual(
    staleStep.steps.length,
    2,
    "Late step must NOT be appended to completed run"
  );
  console.log("✓ Stale events rejected from altering terminal states");

  // 5. Test Failure & Timeout Termination
  console.log("\n[Test 5] Timeout and Failure handling...");
  const testChatId2 = "chat-test-timeout-2";
  ExecutionTracker.startRun({
    chatId: testChatId2,
    sessionId: "session-test-2",
    targetUrl: "https://example.com/long-page",
  });

  const timedOutRun = ExecutionTracker.failRun({
    chatId: testChatId2,
    error: "Browser Use execution deadline exceeded (75s).",
    state: "TIMED_OUT",
  });
  assert(timedOutRun !== null);
  assert.strictEqual(timedOutRun.executionState, "TIMED_OUT");
  assert(timedOutRun.error?.includes("deadline exceeded"));
  assert.strictEqual(
    isTerminalExecutionState(timedOutRun.executionState),
    true
  );

  // 6. Test Cancellation
  console.log("\n[Test 6] User cancellation...");
  const testChatId3 = "chat-test-cancel-3";
  ExecutionTracker.startRun({
    chatId: testChatId3,
    sessionId: "session-test-3",
    targetUrl: "https://example.com/app",
  });

  const cancelledRun = await ExecutionTracker.cancelRun({
    chatId: testChatId3,
  });
  assert(cancelledRun !== null);
  assert.strictEqual(cancelledRun.executionState, "CANCELLED");
  assert.strictEqual(cancelledRun.currentAction, "Cancelled by user");
  console.log("✓ Cancellation lifecycle verified");

  console.log("\n==========================================");
  console.log("ALL CANONICAL LIFECYCLE TESTS PASSED! (6/6)");
  console.log("==========================================");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
