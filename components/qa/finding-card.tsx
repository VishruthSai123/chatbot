"use client";

import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  XCircle,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

export type FindingStatus = "pass" | "fail" | "uncertain" | "blocked";

export interface FindingData {
  actual?: string;
  evidence?: Array<{
    type: string;
    value: string;
    description?: string;
  }>;
  expected?: string;
  findingId?: string | null;
  reproductionSteps?: string[];
  severity?: string;
  status: FindingStatus;
  summary: string;
  title: string;
}

const statusConfig: Record<
  FindingStatus,
  { bg: string; border: string; icon: ReactNode; label: string; text: string }
> = {
  blocked: {
    bg: "bg-zinc-500/10 dark:bg-zinc-400/10",
    border: "border-zinc-300 dark:border-zinc-600",
    icon: <Ban className="size-4" />,
    label: "BLOCKED",
    text: "text-zinc-600 dark:text-zinc-400",
  },
  fail: {
    bg: "bg-red-500/10 dark:bg-red-400/10",
    border: "border-red-300 dark:border-red-600",
    icon: <XCircle className="size-4" />,
    label: "FAIL",
    text: "text-red-600 dark:text-red-400",
  },
  pass: {
    bg: "bg-emerald-500/10 dark:bg-emerald-400/10",
    border: "border-emerald-300 dark:border-emerald-600",
    icon: <CheckCircle2 className="size-4" />,
    label: "PASS",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  uncertain: {
    bg: "bg-amber-500/10 dark:bg-amber-400/10",
    border: "border-amber-300 dark:border-amber-600",
    icon: <HelpCircle className="size-4" />,
    label: "UNCERTAIN",
    text: "text-amber-600 dark:text-amber-400",
  },
};

export function FindingCard({ finding }: { finding: FindingData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = statusConfig[finding.status] ?? statusConfig.uncertain;

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div
      className={cn(
        "w-full rounded-xl border shadow-sm transition-all duration-200",
        config.border,
        config.bg
      )}
    >
      {/* Collapsed Header */}
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={handleToggle}
        type="button"
      >
        <div
          className={cn(
            "flex items-center gap-2 font-semibold text-sm",
            config.text
          )}
        >
          {config.icon}
          <span>{config.label}</span>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
          <span className="truncate text-sm font-medium text-foreground">
            {finding.title}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {finding.summary}
          </span>
        </div>
        <div className="shrink-0 text-muted-foreground">
          {isExpanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded ? (
        <div className="space-y-3 border-t border-border/30 px-4 pb-4 pt-3">
          {finding.expected ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Expected
              </div>
              <div className="mt-1 text-sm text-foreground">
                {finding.expected}
              </div>
            </div>
          ) : null}

          {finding.actual ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Actual
              </div>
              <div className="mt-1 text-sm text-foreground">
                {finding.actual}
              </div>
            </div>
          ) : null}

          {finding.reproductionSteps && finding.reproductionSteps.length > 0 ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Reproduction Steps
              </div>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sm text-foreground">
                {finding.reproductionSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {finding.evidence && finding.evidence.length > 0 ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Evidence
              </div>
              <div className="mt-1 space-y-1">
                {finding.evidence.map((e) => (
                  <div
                    className="flex items-start gap-2 rounded-md bg-background/50 px-2.5 py-1.5 text-xs"
                    key={`${e.type}-${e.value}`}
                  >
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                      {e.type}
                    </span>
                    <span className="text-foreground break-all">
                      {e.description ?? e.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {finding.severity ? (
            <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
              <AlertCircle className="size-3" />
              <span>
                Severity:{" "}
                <span className="font-medium capitalize">
                  {finding.severity}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
