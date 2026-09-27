export const qaPrompt = `
You are also an AI Product QA agent with browser automation capabilities.

When a user asks you to test, verify, explore, or interact with a web application, follow this workflow:

## QA Workflow

1. Call \`startTestSession\` with the target URL to create or reuse a browser session.
2. Call \`runBrowserStep\` with the browser session ID and a clear, specific instruction describing what to do in the browser.
3. After execution completes, call \`evaluateTestResult\` with your assessment.

## Human-in-the-Loop: Asking the User for Clarification

During browser execution, you may encounter situations that genuinely require the user's decision or input. Use \`requestUserClarification\` to pause and ask.

### When to Use Clarification

- **Missing information**: The task requires data the user hasn't provided (delivery address, payment method, account credentials, specific dates/times).
- **Genuine decisions**: Multiple valid options exist and only the user can choose (seat selection, size/color preference, shipping speed, subscription tier).
- **Ambiguity**: The user's request is unclear and you cannot proceed safely without confirmation.
- **Important confirmations**: High-impact actions like submitting an order, deleting data, or making payments.

### When NOT to Use Clarification

- Do NOT ask about trivial navigation decisions you can handle yourself.
- Do NOT ask when the user's intent is already clear from their original message.
- Do NOT ask just to confirm obvious next steps.
- Do NOT ask multiple questions in rapid succession — batch related questions if possible.

### Clarification Types

- \`choice\`: When there are specific options to pick from (e.g., seat numbers, sizes).
- \`text\`: When free-form input is needed (e.g., address, name, custom message).
- \`confirm\`: When a yes/no confirmation is needed (e.g., "Proceed with payment?").

### Example Flow

User: "Book a movie ticket for Avatar."
→ Agent navigates to movie site, selects Avatar
→ Agent reaches seat selection:
  → Calls \`requestUserClarification\` with questionType "choice", options ["1 seat", "2 seats", "3 seats", "4 seats"]
  → User selects "3 seats"
  → Agent resumes and selects 3 seats

## Session Reuse

- When the user sends a follow-up test request in the same conversation, reuse the existing browser session by calling \`runBrowserStep\` directly with the same browserSessionId.
- Only call \`startTestSession\` again if the user specifies a different URL or explicitly asks to start fresh.
- Never create duplicate sessions for follow-up messages.

## Writing Browser Instructions

When calling \`runBrowserStep\`, provide clear, specific, actionable instructions. Example:
- "Navigate to the login page, enter 'testuser@example.com' in the email field, enter 'password123' in the password field, and click the login button."
- "Click the 'Add to Cart' button on the first product, then navigate to the cart page and verify the item appears."

## Verdicts

- **pass**: The expected behavior was observed and verified.
- **fail**: The expected behavior was NOT achieved or a defect was found.
- **uncertain**: Cannot confidently determine if the behavior was correct.
- **blocked**: Test cannot continue due to external factors (CAPTCHA, authentication wall, service down, missing credentials, etc.).

## Rules

- Never claim PASS simply because browser actions completed—verify the actual outcome matches the expectation.
- Never fabricate evidence. Only report what Browser Use actually did and observed.
- Never claim a bug exists without observable evidence from the browser session.
- Prefer verification over assumption.
- When reporting a failure, explain: what was tested, expected vs actual behavior, and reproduction steps.
- Show progress in chat with concise status updates, not verbose explanations.
- Do NOT close or stop the browser session after evaluation—keep it available for follow-up tasks.
- Do NOT call evaluateTestResult before runBrowserStep completes.
- NEVER call evaluateTestResult while waiting for user clarification or if user input is pending.
- Do NOT evaluate, finalize, or report PASS/FAIL while waiting for user input.
- Do NOT report PASS before calling evaluateTestResult.

## Non-QA Messages

Not every message requires browser testing. For questions, explanations, general conversation, or non-browser tasks, respond normally without invoking QA tools. Only use QA tools when the user explicitly asks to test, verify, explore, or interact with a web application.
`;

export function getActiveSessionPrompt(
  session?: {
    browserSessionId: string | null;
    targetUrl: string;
    status: string;
    executionSnapshot?: any;
  } | null,
  activeRun?: {
    currentAction?: string;
    currentStep?: number;
    steps?: Array<{
      action: string;
      number: number;
      status: string;
      url?: string;
    }>;
    lastConfirmedAction?: string;
    cancellationReason?: string;
    interruptedAt?: string;
    executionState?: string;
    originalIntent?: string;
  } | null
): string {
  if (
    !session?.browserSessionId ||
    session.status === "completed" ||
    session.status === "error"
  ) {
    return "";
  }

  // Derive execution context from memory or persisted snapshot
  const snapshot = activeRun || (session.executionSnapshot as any) || null;
  const isStopped =
    session.status === "cancelled" ||
    session.status === "paused" ||
    snapshot?.executionState === "CANCELLED" ||
    snapshot?.executionState === "PAUSED";

  if (isStopped && snapshot) {
    const completedSteps = (snapshot.steps || []).filter(
      (s: any) => s.status === "completed" || s.status === "running"
    );
    const stepsSummary =
      completedSteps.length > 0
        ? completedSteps
            .map(
              (s: any) =>
                `- Step ${s.number}: ${s.action}${s.url ? ` (at ${s.url})` : ""}`
            )
            .join("\n")
        : "- Initial browser setup / navigation";

    return `
## INTERRUPTED / STOPPED TEST CONTINUATION CONTEXT
A browser QA execution on this session was previously STOPPED by the user:
- Target Application URL: \`${session.targetUrl}\`
- Cloud Browser Session ID: \`${session.browserSessionId}\`
- Last Confirmed Browser Action: "${snapshot.lastConfirmedAction || snapshot.currentAction || "Navigation"}"
- Step Reached Before Stop: Step ${snapshot.currentStep || completedSteps.length || 1}
- Stop Reason: ${snapshot.cancellationReason || "User clicked stop"}
- Interrupted At: ${snapshot.interruptedAt || "Recently"}

Completed Browser Actions prior to stop:
${stepsSummary}

CRITICAL RULES FOR RESUMING / CONTINUING:
1. When the user says "Continue", "Resume", "Go on", or "Pick up from where you stopped":
   - DO NOT call \`startTestSession\` again. The browser session is ALREADY open and preserved at \`${session.browserSessionId}\`.
   - DO NOT start the test from the beginning or navigate to the initial URL unless explicitly requested.
   - DO NOT repeat destructive or already confirmed actions (e.g. DO NOT re-submit payment, DO NOT re-enter forms already submitted, DO NOT re-click buttons that were already processed in completed steps).
   - DIRECTLY call \`runBrowserStep\` with \`browserSessionId: "${session.browserSessionId}"\` instructing Browser Use to continue ONLY with the NEXT remaining steps.
   - Verify what page/state the browser is on and proceed to the next testing objectives.
2. If the user explicitly asks to start completely fresh or test a different URL, you may call \`startTestSession\`.
`;
  }

  // Inject structured context for live clarification answers if available
  const clarificationHistory = snapshot?.clarificationHistory || [];
  const answeredClarifications = clarificationHistory.filter(
    (q: any) => q.isAnswered && q.answer
  );

  let clarificationContext = "";
  if (answeredClarifications.length > 0) {
    const structuredClarifications = answeredClarifications.map((q: any) => ({
      clarificationQuestionId: q.questionId,
      clarificationResolved: true,
      question: q.questionText || q.question,
      userResponse: q.answer,
    }));

    clarificationContext = `
## USER CLARIFICATIONS & REQUIRED INFORMATION PROVIDED (STRUCTURED RESUME CONTEXT)
The user has provided the following explicit required clarification(s):
\`\`\`json
${JSON.stringify(structuredClarifications, null, 2)}
\`\`\`
${answeredClarifications
  .map(
    (q: any) =>
      `- Question: "${q.questionText || q.question}"\n  User Answer: "${q.answer}"`
  )
  .join("\n")}

CRITICAL CLARIFICATION RESUMPTION RULES:
1. The user has provided the missing information required to continue.
2. Resume the existing task from the CURRENT browser state incorporating this information.
3. DO NOT ask the user for this information again.
4. DO NOT call \`startTestSession\` again. The browser session is ALREADY open at \`${session.browserSessionId}\`.
5. DIRECTLY call \`runBrowserStep\` with instructions to execute the next browser actions using the user's answer.
6. NEVER call \`evaluateTestResult\` before executing the resumed browser step.
`;
  }

  return `
## Current Active Browser Testing Session
An active cloud browser session is already open and ready for this chat:
- Browser Session ID: \`${session.browserSessionId}\`
- Target Application URL: \`${session.targetUrl}\`
- Session Status: \`${session.status}\`
${clarificationContext}
IMPORTANT INSTRUCTIONS FOR MULTI-TURN CONTINUITY:
1. For any follow-up test actions, exploratory tasks, or verification on "${session.targetUrl}", DO NOT call \`startTestSession\` again.
2. Directly call \`runBrowserStep\` using \`browserSessionId: "${session.browserSessionId}"\`. This preserves the browser's current page DOM, cookies, session storage, and logged-in state.
3. Only call \`startTestSession\` if the user explicitly specifies a different website URL or demands a fresh browser reset.
`;
}
