"use client";

import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleX,
  Copy,
  Download,
  FileText,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

interface StatusStyleConfig {
  badgeBg: string;
  badgeText: string;
  border: string;
  cardBg: string;
  icon: ReactNode;
  label: string;
}

const statusConfig: Record<FindingStatus, StatusStyleConfig> = {
  blocked: {
    badgeBg: "bg-zinc-500/15 dark:bg-zinc-400/15",
    badgeText: "text-zinc-600 dark:text-zinc-400",
    border: "border-zinc-300/80 dark:border-zinc-700/60",
    cardBg: "bg-zinc-500/[0.03] dark:bg-zinc-400/[0.04]",
    icon: <Ban className="size-3.5" />,
    label: "BLOCKED",
  },
  fail: {
    badgeBg: "bg-red-500/15 dark:bg-red-400/15",
    badgeText: "text-red-600 dark:text-red-400",
    border: "border-red-300/80 dark:border-red-700/60",
    cardBg: "bg-red-500/[0.03] dark:bg-red-400/[0.04]",
    icon: <CircleX className="size-3.5" />,
    label: "FAIL",
  },
  pass: {
    badgeBg: "bg-emerald-500/15 dark:bg-emerald-400/15",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-300/80 dark:border-emerald-700/60",
    cardBg: "bg-emerald-500/[0.03] dark:bg-emerald-400/[0.04]",
    icon: <CheckCircle2 className="size-3.5" />,
    label: "PASS",
  },
  uncertain: {
    badgeBg: "bg-amber-500/15 dark:bg-amber-400/15",
    badgeText: "text-amber-600 dark:text-amber-400",
    border: "border-amber-300/80 dark:border-amber-700/60",
    cardBg: "bg-amber-500/[0.03] dark:bg-amber-400/[0.04]",
    icon: <CircleAlert className="size-3.5" />,
    label: "UNCERTAIN",
  },
};

export function FindingCard({ finding }: { finding: FindingData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedType, setCopiedType] = useState<"report" | "steps" | null>(null);
  const config = statusConfig[finding.status] ?? statusConfig.uncertain;

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const generateMarkdownReport = useCallback((): string => {
    const lines: string[] = [
      `### QA Finding: ${finding.title}`,
      `**Verdict:** ${finding.status.toUpperCase()} | **Severity:** ${finding.severity ?? "medium"}`,
      "",
      `**Summary:** ${finding.summary}`,
    ];

    if (finding.expected) {
      lines.push("", `**Expected Outcome:**\n${finding.expected}`);
    }

    if (finding.actual) {
      lines.push("", `**Actual Result:**\n${finding.actual}`);
    }

    if (finding.reproductionSteps && finding.reproductionSteps.length > 0) {
      lines.push("", "**Reproduction Steps:**");
      let idx = 1;
      for (const step of finding.reproductionSteps) {
        lines.push(`${idx}. ${step}`);
        idx += 1;
      }
    }

    if (finding.evidence && finding.evidence.length > 0) {
      lines.push("", "**Evidence:**");
      for (const e of finding.evidence) {
        lines.push(`- \`[${e.type}]\` ${e.description ?? e.value}`);
      }
    }

    return lines.join("\n");
  }, [finding]);

  const handleCopyReport = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const report = generateMarkdownReport();
      try {
        await navigator.clipboard.writeText(report);
        setCopiedType("report");
        toast.success("QA Bug Report copied to clipboard!");
        setTimeout(() => setCopiedType(null), 2000);
      } catch {
        toast.error("Failed to copy report to clipboard");
      }
    },
    [generateMarkdownReport]
  );

  const handleCopySteps = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!finding.reproductionSteps?.length) {
        return;
      }
      const steps = finding.reproductionSteps
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n");
      try {
        await navigator.clipboard.writeText(steps);
        setCopiedType("steps");
        toast.success("Reproduction steps copied!");
        setTimeout(() => setCopiedType(null), 2000);
      } catch {
        toast.error("Failed to copy reproduction steps");
      }
    },
    [finding.reproductionSteps]
  );

  const handleDownloadReport = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const report = generateMarkdownReport();
      const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = finding.title
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")
        .slice(0, 30);
      link.href = url;
      link.download = `qa_finding_${safeName || "report"}.md`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("QA Report downloaded!");
    },
    [finding.title, generateMarkdownReport]
  );

  return (
    <div
      className={cn(
        "w-full max-w-[min(100%,560px)] rounded-lg border text-left transition-all duration-150 overflow-hidden",
        config.border,
        config.cardBg
      )}
    >
      {/* Compact Header: [Icon Badge] Title / Summary ... [Actions] */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
        onClick={handleToggle}
        type="button"
      >
        {/* Semantic Badge */}
        <div
          className={cn(
            "inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold tracking-wide select-none",
            config.badgeBg,
            config.badgeText
          )}
        >
          {config.icon}
          <span>{config.label}</span>
        </div>

        {/* Title & Short Description */}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-foreground">
            {finding.title}
          </span>
          {finding.summary ? (
            <span className="truncate text-[11px] text-muted-foreground/80">
              {finding.summary}
            </span>
          ) : null}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0 text-muted-foreground/70">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Copy markdown report"
                className="p-1 rounded hover:bg-background/80 hover:text-foreground transition-colors cursor-pointer"
                onClick={handleCopyReport}
                type="button"
              >
                {copiedType === "report" ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Copy markdown report</TooltipContent>
          </Tooltip>

          <span aria-hidden="true" className="p-1 rounded transition-colors">
            {isExpanded ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </span>
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded ? (
        <div className="space-y-2.5 border-t border-border/20 px-3 pb-3 pt-2.5 text-xs">
          {finding.expected ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Expected
              </div>
              <div className="mt-0.5 text-xs text-foreground/90 leading-relaxed">
                {finding.expected}
              </div>
            </div>
          ) : null}

          {finding.actual ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Actual
              </div>
              <div className="mt-0.5 text-xs text-foreground/90 leading-relaxed">
                {finding.actual}
              </div>
            </div>
          ) : null}

          {finding.reproductionSteps && finding.reproductionSteps.length > 0 ? (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Reproduction Steps
                </span>
                <button
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
                  onClick={handleCopySteps}
                  type="button"
                >
                  {copiedType === "steps" ? (
                    <Check className="size-3 text-emerald-500" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  <span>
                    {copiedType === "steps" ? "Copied" : "Copy Steps"}
                  </span>
                </button>
              </div>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-foreground/90 leading-relaxed">
                {finding.reproductionSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {finding.evidence && finding.evidence.length > 0 ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Evidence
              </div>
              <div className="mt-1 space-y-1">
                {finding.evidence.map((e) => (
                  <div
                    className="flex items-start gap-1.5 rounded bg-background/50 border border-border/20 px-2 py-1 text-[11px]"
                    key={`${e.type}-${e.value}`}
                  >
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[9px] uppercase text-muted-foreground font-semibold">
                      {e.type}
                    </span>
                    <span className="text-foreground/90 break-all leading-tight">
                      {e.description ?? e.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Footer with Metadata & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/15 text-[11px] text-muted-foreground/80">
            {finding.severity ? (
              <div className="flex items-center gap-1">
                <CircleAlert className="size-3" />
                <span>
                  Severity:{" "}
                  <span className="font-medium capitalize text-foreground">
                    {finding.severity}
                  </span>
                </span>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-1.5">
              <Button
                className="h-6 text-[11px] px-2 gap-1 rounded"
                onClick={handleCopyReport}
                size="sm"
                variant="outline"
              >
                {copiedType === "report" ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <FileText className="size-3" />
                )}
                <span>Copy Report</span>
              </Button>

              <Button
                className="h-6 text-[11px] px-2 gap-1 rounded"
                onClick={handleDownloadReport}
                size="sm"
                variant="outline"
              >
                <Download className="size-3" />
                <span>Export .md</span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
