"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionTickStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "warning";

export interface ActionTickData {
  action: string;
  durationMs?: number;
  goal?: string;
  number?: number;
  status: ActionTickStatus;
  timestamp?: string;
  url?: string;
}

const statusStyles: Record<
  ActionTickStatus,
  {
    bg: string;
    border: string;
    icon: React.ReactNode;
    iconColor: string;
    pulse?: boolean;
    text: string;
  }
> = {
  completed: {
    bg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    border: "border-emerald-500/20 dark:border-emerald-500/30",
    icon: <CheckCircle2 className="size-3.5" />,
    iconColor: "text-emerald-600 dark:text-emerald-400",
    text: "text-foreground",
  },
  failed: {
    bg: "bg-red-500/10 dark:bg-red-500/15",
    border: "border-red-500/20 dark:border-red-500/30",
    icon: <XCircle className="size-3.5" />,
    iconColor: "text-red-600 dark:text-red-400",
    text: "text-foreground",
  },
  pending: {
    bg: "bg-muted/40",
    border: "border-border/40",
    icon: <span className="size-2 rounded-full bg-muted-foreground/40" />,
    iconColor: "text-muted-foreground",
    text: "text-muted-foreground",
  },
  running: {
    bg: "bg-primary/10 dark:bg-primary/15",
    border: "border-primary/25 dark:border-primary/35",
    icon: <Loader2 className="size-3.5 animate-spin" />,
    iconColor: "text-primary",
    pulse: true,
    text: "text-foreground font-medium",
  },
  warning: {
    bg: "bg-amber-500/10 dark:bg-amber-500/15",
    border: "border-amber-500/20 dark:border-amber-500/30",
    icon: <AlertTriangle className="size-3.5" />,
    iconColor: "text-amber-600 dark:text-amber-400",
    text: "text-foreground",
  },
};

export function ActionTick({
  tick,
  className,
  isLatest = false,
}: {
  tick: ActionTickData;
  className?: string;
  isLatest?: boolean;
}) {
  const style = statusStyles[tick.status] ?? statusStyles.pending;

  return (
    <div
      className={cn(
        "group relative flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs transition-all duration-200",
        style.bg,
        style.border,
        isLatest && tick.status === "running" && "ring-1 ring-primary/30",
        className
      )}
    >
      {/* Status Icon */}
      <div
        className={cn("mt-0.5 shrink-0 transition-transform", style.iconColor)}
      >
        {style.icon}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          {typeof tick.number === "number" ? (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              #{tick.number}
            </span>
          ) : null}
          <span className={cn("truncate text-xs leading-tight", style.text)}>
            {tick.action}
          </span>
        </div>

        {/* Optional Secondary Info: Goal / URL */}
        {tick.url ? (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/80 truncate">
            <Globe className="size-2.5 shrink-0" />
            <span className="truncate">{tick.url}</span>
          </div>
        ) : null}
      </div>

      {/* Optional Right Meta: Timing or Running Badge */}
      {tick.status === "running" ? (
        <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-primary">
          live
        </span>
      ) : null}
    </div>
  );
}

export function ActionTimeline({
  ticks,
  className,
  currentInstruction,
}: {
  ticks: ActionTickData[];
  className?: string;
  currentInstruction?: string;
}) {
  if (!ticks.length && !currentInstruction) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-1.5 w-full", className)}>
      {currentInstruction ? (
        <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          <span className="truncate">Task: {currentInstruction}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {ticks.map((tick, idx) => (
          <ActionTick
            isLatest={idx === ticks.length - 1}
            key={`${tick.number ?? idx}-${tick.action}`}
            tick={tick}
          />
        ))}
      </div>
    </div>
  );
}
