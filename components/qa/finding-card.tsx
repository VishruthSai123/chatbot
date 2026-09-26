"use client";

import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  HelpCircle,
  XCircle,
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
        "w-full rounded-xl border shadow-sm transition-all duration-200 overflow-hidden",
        config.border,
        config.bg
      )}
    >
      {/* Collapsed Header */}
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
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
        <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
          {/* Quick Copy Action */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-1 rounded-md hover:bg-background/80 hover:text-foreground transition-colors cursor-pointer"
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

          {isExpanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded ? (
        <div className="space-y-3.5 border-t border-border/30 px-4 pb-4 pt-3.5">
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
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Reproduction Steps
                </span>
                <button
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
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
              <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-sm text-foreground">
                {finding.reproductionSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {finding.evidence && finding.evidence.length > 0 ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Evidence & Artifacts
              </div>
              <div className="mt-1.5 space-y-1">
                {finding.evidence.map((e) => (
                  <div
                    className="flex items-start gap-2 rounded-md bg-background/60 border border-border/30 px-2.5 py-1.5 text-xs"
                    key={`${e.type}-${e.value}`}
                  >
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground font-semibold">
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

          {/* Footer with Metadata & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/20 text-xs text-muted-foreground">
            {finding.severity ? (
              <div className="flex items-center gap-1.5">
                <AlertCircle className="size-3.5" />
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

            <div className="flex items-center gap-2">
              <Button
                className="h-7 text-xs px-2.5 gap-1.5"
                onClick={handleCopyReport}
                size="sm"
                variant="outline"
              >
                {copiedType === "report" ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <FileText className="size-3" />
                )}
                <span>Copy Bug Report</span>
              </Button>

              <Button
                className="h-7 text-xs px-2.5 gap-1.5"
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
