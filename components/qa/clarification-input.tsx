"use client";

import { CheckIcon, MessageCircleQuestion, SendHorizonal } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClarificationQuestion } from "@/lib/qa/execution-types";
import { cn } from "@/lib/utils";

interface ClarificationInputProps {
  chatId: string;
  className?: string;
  /** Called after the answer is successfully submitted */
  onAnswered?: (questionId: string, answer: string) => void;
  question: ClarificationQuestion;
}

/**
 * ClarificationInput renders the agent's question and provides
 * the appropriate input UI (choice buttons, text field, or confirm buttons).
 * It submits the answer to /api/qa/clarification and calls onAnswered.
 */
export const ClarificationInput = memo(function PureClarificationInput({
  chatId,
  className,
  question,
  onAnswered,
}: ClarificationInputProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(question.isAnswered);
  const [submittedAnswer, setSubmittedAnswer] = useState<string | null>(
    question.answer ?? null
  );
  const [textValue, setTextValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // If the question was already answered (e.g. on reload), show answered state
  useEffect(() => {
    if (question.isAnswered && question.answer) {
      setSubmitted(true);
      setSubmittedAnswer(question.answer);
    }
  }, [question.isAnswered, question.answer]);

  const submitAnswer = useCallback(
    async (answer: string) => {
      if (isSubmitting || submitted) {
        return;
      }
      setIsSubmitting(true);

      try {
        const res = await fetch("/api/qa/clarification", {
          body: JSON.stringify({
            answer,
            chatId,
            questionId: question.questionId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const data = await res.json();

        if (data.cancelled) {
          setSubmitted(true);
          setSubmittedAnswer("Cancelled");
          onAnswered?.(question.questionId, "Cancel");
          window.dispatchEvent(
            new CustomEvent("qa:stop-requested", {
              detail: { chatId },
            })
          );
        } else if (data.success || data.alreadyAnswered) {
          setSubmitted(true);
          setSubmittedAnswer(answer);
          onAnswered?.(question.questionId, answer);
        } else {
          console.error(
            "[ClarificationInput] Failed to submit answer:",
            data.error
          );
        }
      } catch (err) {
        console.error("[ClarificationInput] Error submitting answer:", err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [chatId, question.questionId, isSubmitting, submitted, onAnswered]
  );

  const handleTextSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = textValue.trim();
      if (trimmed) {
        submitAnswer(trimmed);
      }
    },
    [textValue, submitAnswer]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleTextSubmit();
      }
    },
    [handleTextSubmit]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTextValue(e.target.value);
    },
    []
  );

  const handleOptionClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const opt = e.currentTarget.getAttribute("data-option");
      if (opt) {
        submitAnswer(opt);
      }
    },
    [submitAnswer]
  );

  const resolvedType = useMemo(() => {
    const rawType = question.questionType || question.inputType || "text";
    if (rawType === "confirmation") {
      return "confirm";
    }
    return rawType;
  }, [question.questionType, question.inputType]);

  const displayQuestion =
    question.questionText || question.question || "Input required";

  // Auto-focus input
  useEffect(() => {
    if (
      (resolvedType === "text" || resolvedType === "number") &&
      !submitted &&
      inputRef.current
    ) {
      inputRef.current.focus();
    }
  }, [resolvedType, submitted]);

  const options = useMemo(() => {
    if (resolvedType === "confirm") {
      return question.options?.length
        ? question.options
        : ["Continue", "Cancel"];
    }
    return question.options ?? [];
  }, [resolvedType, question.options]);

  // Already answered state
  if (submitted && submittedAnswer) {
    return (
      <div
        className={cn(
          "w-full max-w-[min(100%,480px)] animate-in fade-in-0 duration-300",
          className
        )}
      >
        <div className="rounded-xl border border-border/40 bg-gradient-to-br from-muted/40 to-muted/20 px-4 py-3">
          <div className="flex items-start gap-2.5">
            {submittedAnswer.toLowerCase() === "cancel" ||
            submittedAnswer === "Cancelled" ? (
              <span className="mt-0.5 size-4 shrink-0 text-red-500 font-bold text-xs flex items-center justify-center">
                ✕
              </span>
            ) : (
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-relaxed text-muted-foreground/80">
                {displayQuestion}
              </p>
              <p className="mt-1.5 text-[13px] font-medium leading-snug text-foreground">
                {submittedAnswer}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full max-w-[min(100%,480px)] animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
        className
      )}
    >
      <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.04] to-primary/[0.02] shadow-sm">
        {/* Question header */}
        <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-2.5">
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-primary/70" />
          <p className="text-[13px] font-medium leading-relaxed text-foreground">
            {displayQuestion}
          </p>
        </div>

        {/* Input area */}
        <div className="px-4 pb-3.5">
          {/* Choice or confirm buttons */}
          {(resolvedType === "choice" || resolvedType === "confirm") && (
            <div
              className={cn(
                "flex flex-wrap gap-2",
                resolvedType === "confirm" && "gap-2.5"
              )}
            >
              {options.map((option) => (
                <button
                  className={cn(
                    "relative rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-all duration-150 cursor-pointer",
                    "border-border/50 bg-background/80 text-foreground",
                    "hover:border-primary/40 hover:bg-primary/[0.06] hover:shadow-sm",
                    "active:scale-[0.97]",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    resolvedType === "confirm" &&
                      (option.toLowerCase() === "continue" ||
                        option.toLowerCase() === "yes") &&
                      "hover:border-emerald-400/50 hover:bg-emerald-500/[0.06]",
                    resolvedType === "confirm" &&
                      (option.toLowerCase() === "cancel" ||
                        option.toLowerCase() === "no") &&
                      "hover:border-red-400/50 hover:bg-red-500/[0.06]"
                  )}
                  data-option={option}
                  disabled={isSubmitting}
                  key={option}
                  onClick={handleOptionClick}
                  type="button"
                >
                  {isSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground/60" />
                      <span className="text-muted-foreground">Sending...</span>
                    </span>
                  ) : (
                    option
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Text or Number input */}
          {(resolvedType === "text" || resolvedType === "number") && (
            <form
              className="flex items-center gap-2"
              onSubmit={handleTextSubmit}
            >
              <div className="relative flex-1">
                <input
                  className={cn(
                    "w-full rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[13px] text-foreground",
                    "placeholder:text-muted-foreground/50",
                    "focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20",
                    "disabled:opacity-50"
                  )}
                  disabled={isSubmitting}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    question.placeholder ||
                    (resolvedType === "number"
                      ? "Enter a number..."
                      : "Type your answer...")
                  }
                  ref={inputRef}
                  type={resolvedType === "number" ? "number" : "text"}
                  value={textValue}
                />
              </div>
              <button
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer",
                  textValue.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                    : "bg-muted/50 text-muted-foreground/40 cursor-not-allowed"
                )}
                disabled={!textValue.trim() || isSubmitting}
                title="Submit answer"
                type="submit"
              >
                {isSubmitting ? (
                  <span className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                ) : (
                  <SendHorizonal className="size-3.5" />
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
});

ClarificationInput.displayName = "ClarificationInput";
