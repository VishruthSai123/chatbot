"use client";

import {
  AlertCircle,
  ExternalLink,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  RotateCw,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useArtifact } from "@/hooks/use-artifact";
import type { CanonicalExecutionState } from "@/lib/qa/execution-types";
import { cn, fetcher } from "@/lib/utils";
import { Shimmer } from "../ai-elements/shimmer";

export type BrowserStatus =
  | "connecting"
  | "live"
  | "working"
  | "idle"
  | "error"
  | "stopped";

export type BrowserArtifactMetadata = {
  sessionId?: string;
  browserSessionId?: string;
  browserScreenHeight?: number;
  browserScreenWidth?: number;
  liveUrl?: string;
  targetUrl?: string;
  currentUrl?: string;
  status?: BrowserStatus;
  executionState?: CanonicalExecutionState;
  runId?: string;
  sequence?: number;
  verdict?: "pass" | "fail" | "uncertain" | "blocked";
  findingId?: string | null;
  currentAction?: string;
  recentSteps?: Array<{
    number?: number;
    action: string;
    goal?: string;
    url?: string;
    status?: "running" | "completed" | "failed";
  }>;
  errorMessage?: string;
  isFullscreen?: boolean;
};

interface BrowserPreviewProps {
  metadata?: BrowserArtifactMetadata;
  setMetadata?: (
    metadata:
      | BrowserArtifactMetadata
      | ((prev: BrowserArtifactMetadata) => BrowserArtifactMetadata)
  ) => void;
  title?: string;
}

export function BrowserPreview({
  metadata,
  setMetadata,
  title,
}: BrowserPreviewProps) {
  const { chatId, browserDimensions, setBrowserDimensions } = useActiveChat();
  const { setArtifact } = useArtifact();
  const [iframeKey] = useState<number>(0);
  const [isStopping, setIsStopping] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [wrapperDimensions, setWrapperDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!wrapperRef.current) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const dims = {
            height: Math.round(height),
            width: Math.round(width),
          };
          setWrapperDimensions(dims);
          setBrowserDimensions?.(dims);
        }
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [setBrowserDimensions]);

  const isExecuting =
    metadata?.executionState === "STARTING" ||
    metadata?.executionState === "RUNNING" ||
    metadata?.executionState === "CANCELLING" ||
    metadata?.executionState === "RESUMING" ||
    metadata?.status === "working";

  // Reconcile from backend if liveUrl is missing OR if execution is actively running/recovering
  const shouldFetchSession =
    Boolean(chatId) && (!metadata?.liveUrl || isExecuting);

  const sessionQuery = useMemo(() => {
    if (!shouldFetchSession) {
      return null;
    }
    const params = new URLSearchParams({ chatId: chatId ?? "" });
    if (wrapperDimensions) {
      params.set("width", String(wrapperDimensions.width));
      params.set("height", String(wrapperDimensions.height));
    }
    return `/api/qa/session?${params.toString()}`;
  }, [shouldFetchSession, chatId, wrapperDimensions]);

  const {
    data: sessionData,
    error: sessionFetchError,
    isLoading: isSessionFetching,
    mutate: mutateSession,
  } = useSWR<{
    session: {
      id: string;
      browserSessionId: string;
      browserScreenHeight?: number;
      browserScreenWidth?: number;
      liveUrl: string | null;
      targetUrl: string;
      status: string;
    } | null;
    execution: any;
  }>(sessionQuery, fetcher, {
    refreshInterval: isExecuting ? 2500 : 0,
    revalidateOnFocus: false,
  });

  // Sync DB session and execution into metadata if found
  useEffect(() => {
    if (sessionData?.session?.liveUrl && setMetadata) {
      const s = sessionData.session;
      const exec = sessionData.execution;
      setMetadata((prev) => {
        const safePrev = prev ?? {};
        // If currently CANCELLED or CANCELLING, do NOT allow regression to RUNNING, WAITING, or COMPLETED
        if (
          (safePrev.executionState === "CANCELLED" ||
            safePrev.executionState === "CANCELLING") &&
          exec?.executionState !== "CANCELLED"
        ) {
          return safePrev;
        }

        // Monotonic sequence check: ignore stale snapshots
        if (
          safePrev.sequence &&
          exec?.sequence &&
          exec.sequence < safePrev.sequence
        ) {
          return safePrev;
        }

        return {
          ...safePrev,
          browserScreenHeight:
            s.browserScreenHeight ?? safePrev.browserScreenHeight,
          browserScreenWidth:
            s.browserScreenWidth ?? safePrev.browserScreenWidth,
          browserSessionId: s.browserSessionId,
          liveUrl: s.liveUrl ?? undefined,
          status:
            (s.status === "active" ? "live" : (s.status as BrowserStatus)) ??
            "live",
          targetUrl: s.targetUrl,
          ...(exec
            ? {
                currentAction: exec.currentAction || safePrev.currentAction,
                errorMessage: exec.error || safePrev.errorMessage,
                executionState: exec.executionState || safePrev.executionState,
                findingId: exec.findingId || safePrev.findingId,
                recentSteps: exec.steps || safePrev.recentSteps,
                runId: exec.runId || safePrev.runId,
                sequence: exec.sequence || safePrev.sequence,
                verdict: exec.verdict || safePrev.verdict,
              }
            : {}),
        };
      });
    }
  }, [sessionData, setMetadata]);

  const liveUrl = metadata?.liveUrl ?? sessionData?.session?.liveUrl ?? null;
  const targetUrl =
    metadata?.targetUrl ??
    sessionData?.session?.targetUrl ??
    "https://localhost";
  const currentUrl = metadata?.currentUrl ?? targetUrl;
  const rawStatus =
    metadata?.status ??
    (liveUrl ? "live" : isSessionFetching ? "connecting" : "idle");
  const status: BrowserStatus =
    metadata?.executionState === "TIMED_OUT" ||
    metadata?.executionState === "FAILED" ||
    sessionFetchError
      ? "error"
      : metadata?.executionState === "CANCELLED"
        ? "stopped"
        : rawStatus;
  const isFullscreen = Boolean(metadata?.isFullscreen);

  const handleToggleFullscreen = useCallback(() => {
    if (!setMetadata) {
      return;
    }
    setMetadata((prev) => ({
      ...prev,
      isFullscreen: !prev.isFullscreen,
    }));
  }, [setMetadata]);

  const handleClose = useCallback(() => {
    setArtifact((prev) => ({
      ...prev,
      isVisible: false,
    }));
  }, [setArtifact]);

  const handleRetry = useCallback(() => {
    mutateSession();
  }, [mutateSession]);

  const handleStopSession = useCallback(async () => {
    if (!chatId || isStopping) {
      return;
    }
    setIsStopping(true);
    setMetadata?.((prev) => ({
      ...prev,
      currentAction: "Stopping test execution...",
      executionState: "CANCELLING",
      status: "working",
    }));
    window.dispatchEvent(
      new CustomEvent("qa:cancelling-requested", {
        detail: { chatId },
      })
    );
    try {
      const res = await fetch("/api/qa/session", {
        body: JSON.stringify({ action: "stop", chatId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await res.json();
      mutateSession();
      setMetadata?.((prev) => {
        const safePrev = prev ?? {};
        return {
          ...safePrev,
          currentAction:
            data?.execution?.currentAction || "Test was stopped by user.",
          executionState: data?.execution?.executionState || "CANCELLED",
          lastConfirmedAction: data?.execution?.lastConfirmedAction,
          recentSteps: data?.execution?.steps || safePrev.recentSteps,
          status: "stopped",
        };
      });
      window.dispatchEvent(
        new CustomEvent("qa:stop-requested", {
          detail: { chatId },
        })
      );
    } catch (err) {
      console.error("[BrowserPreview] Error stopping session:", err);
    } finally {
      setIsStopping(false);
    }
  }, [chatId, isStopping, mutateSession, setMetadata]);

  const handleResumeSession = useCallback(async () => {
    if (!chatId || isResuming) {
      return;
    }
    setIsResuming(true);
    setMetadata?.((prev) => ({
      ...(prev ?? {}),
      currentAction: "Resuming test execution...",
      executionState: "RESUMING",
      status: "working",
    }));
    try {
      const res = await fetch("/api/qa/session", {
        body: JSON.stringify({ action: "resume", chatId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await res.json();
      mutateSession();
      if (data?.execution) {
        setMetadata?.((prev) => {
          const safePrev = prev ?? {};
          return {
            ...safePrev,
            currentAction: data.execution.currentAction || "Resuming test...",
            executionState: data.execution.executionState || "RESUMING",
            recentSteps: data.execution.steps || safePrev.recentSteps,
            status: "working",
          };
        });
      }
      window.dispatchEvent(
        new CustomEvent("qa:resume-requested", {
          detail: { chatId },
        })
      );
    } catch (err) {
      console.error("[BrowserPreview] Error resuming session:", err);
    } finally {
      setIsResuming(false);
    }
  }, [chatId, isResuming, mutateSession, setMetadata]);

  useEffect(() => {
    const handleRemoteCancelling = (e: Event) => {
      const customEvent = e as CustomEvent<{ chatId: string }>;
      if (customEvent.detail?.chatId === chatId) {
        setIsStopping(true);
        setMetadata?.((prev) => ({
          ...prev,
          currentAction: "Stopping test execution...",
          executionState: "CANCELLING",
          status: "working",
        }));
      }
    };
    window.addEventListener("qa:cancelling-requested", handleRemoteCancelling);
    return () =>
      window.removeEventListener(
        "qa:cancelling-requested",
        handleRemoteCancelling
      );
  }, [chatId, setMetadata]);

  useEffect(() => {
    const handleRemoteStop = (e: Event) => {
      const customEvent = e as CustomEvent<{ chatId: string }>;
      if (customEvent.detail?.chatId === chatId) {
        setIsStopping(false);
        mutateSession();
        setMetadata?.((prev) => ({
          ...prev,
          currentAction: "Test was stopped by user.",
          executionState: "CANCELLED",
          status: "stopped",
        }));
      }
    };
    window.addEventListener("qa:stop-requested", handleRemoteStop);
    return () =>
      window.removeEventListener("qa:stop-requested", handleRemoteStop);
  }, [chatId, mutateSession, setMetadata]);

  const handleOpenExternal = useCallback(() => {
    if (liveUrl) {
      window.open(liveUrl, "_blank", "noopener,noreferrer");
    }
  }, [liveUrl]);

  // Extract a clean domain / display title
  const displayHost = useMemo(() => {
    try {
      return new URL(currentUrl).hostname;
    } catch {
      return title || "Live Browser";
    }
  }, [currentUrl, title]);

  // Determine effective aspect ratio of the remote browser session
  const activeAspectRatio = useMemo(() => {
    if (metadata?.browserScreenWidth && metadata?.browserScreenHeight) {
      return metadata.browserScreenWidth / metadata.browserScreenHeight;
    }
    if (
      sessionData?.session?.browserScreenWidth &&
      sessionData?.session?.browserScreenHeight
    ) {
      return (
        sessionData.session.browserScreenWidth /
        sessionData.session.browserScreenHeight
      );
    }
    if (browserDimensions?.width && browserDimensions?.height) {
      return browserDimensions.width / browserDimensions.height;
    }
    return 1100 / 1440;
  }, [
    metadata?.browserScreenWidth,
    metadata?.browserScreenHeight,
    sessionData?.session?.browserScreenWidth,
    sessionData?.session?.browserScreenHeight,
    browserDimensions?.width,
    browserDimensions?.height,
  ]);

  // Compute exact tight-bounding dimensions inside wrapper to guarantee zero letterbox gaps
  const fittedDimensions = useMemo(() => {
    if (
      !liveUrl ||
      !wrapperDimensions ||
      wrapperDimensions.width <= 0 ||
      wrapperDimensions.height <= 0
    ) {
      return null;
    }

    const availableWidth = wrapperDimensions.width;
    const availableHeight = wrapperDimensions.height;
    const ratio = activeAspectRatio;

    let width = availableWidth;
    let height = Math.round(width / ratio);

    if (height > availableHeight) {
      height = availableHeight;
      width = Math.round(height * ratio);
    }

    return {
      height: Math.max(1, height),
      width: Math.max(1, width),
    };
  }, [liveUrl, wrapperDimensions, activeAspectRatio]);

  return (
    <div
      className={cn(
        "flex h-full w-full min-h-0 min-w-0 flex-1 flex-col bg-sidebar select-none transition-all duration-200",
        isFullscreen && "fixed inset-0 z-50 bg-background"
      )}
    >
      {/* ─── SINGLE APPLICATION-LEVEL WORKSPACE HEADER ─── */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 bg-sidebar px-3.5">
        {/* Left: QA Workspace Identity + Target Domain + Live Status */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground ring-1 ring-border/40">
            <Globe className="size-3.5" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="max-w-[180px] sm:max-w-[260px] truncate text-xs font-semibold text-foreground tracking-tight"
              title={currentUrl}
            >
              {displayHost}
            </span>

            {/* Subtle Live Status Indicator */}
            <div className="flex items-center gap-1.5 text-[11px]">
              {isStopping || metadata?.executionState === "CANCELLING" ? (
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Cancelling…
                </span>
              ) : isResuming || metadata?.executionState === "RESUMING" ? (
                <span className="flex items-center gap-1 font-medium text-blue-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
                  Resuming…
                </span>
              ) : status === "live" ? (
                <span className="flex items-center gap-1 font-medium text-emerald-500">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              ) : status === "working" ? (
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Agent working
                </span>
              ) : status === "connecting" ? (
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Connecting
                </span>
              ) : status === "error" ? (
                <span className="flex items-center gap-1 font-medium text-destructive">
                  <span className="size-1.5 rounded-full bg-destructive" />
                  Error
                </span>
              ) : status === "stopped" ||
                metadata?.executionState === "CANCELLED" ||
                metadata?.executionState === "PAUSED" ? (
                <span className="flex items-center gap-1 font-medium text-amber-500/90">
                  <span className="size-1.5 rounded-full bg-amber-500/80" />
                  Stopped
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  Ready
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Essential Workspace Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {liveUrl ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Open live view in new tab"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={handleOpenExternal}
                  size="icon"
                  variant="ghost"
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in new tab</TooltipContent>
            </Tooltip>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={
                  isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                }
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={handleToggleFullscreen}
                size="icon"
                variant="ghost"
              >
                {isFullscreen ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </TooltipContent>
          </Tooltip>

          {/* STOP CONTROL */}
          {(status === "live" || status === "working" || isStopping) &&
            metadata?.executionState !== "CANCELLED" &&
            metadata?.executionState !== "COMPLETED" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={
                      isStopping ? "Cancelling..." : "Stop test execution"
                    }
                    className="size-7 text-muted-foreground hover:text-destructive"
                    disabled={
                      isStopping || metadata?.executionState === "CANCELLING"
                    }
                    onClick={handleStopSession}
                    size="icon"
                    variant="ghost"
                  >
                    {isStopping || metadata?.executionState === "CANCELLING" ? (
                      <Loader2 className="size-3.5 animate-spin text-amber-500" />
                    ) : (
                      <Square className="size-3 fill-current" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isStopping || metadata?.executionState === "CANCELLING"
                    ? "Cancelling..."
                    : "Stop test execution"}
                </TooltipContent>
              </Tooltip>
            )}

          {/* RESUME CONTROL */}
          {(metadata?.executionState === "CANCELLED" ||
            metadata?.executionState === "PAUSED" ||
            status === "stopped") &&
            metadata?.executionState !== "COMPLETED" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={
                      isResuming ? "Resuming..." : "Resume test execution"
                    }
                    className="size-7 text-emerald-600 hover:text-emerald-500 hover:bg-emerald-500/10"
                    disabled={
                      isResuming || metadata?.executionState === "RESUMING"
                    }
                    onClick={handleResumeSession}
                    size="icon"
                    variant="ghost"
                  >
                    {isResuming || metadata?.executionState === "RESUMING" ? (
                      <Loader2 className="size-3.5 animate-spin text-emerald-500" />
                    ) : (
                      <Play className="size-3.5 fill-current" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isResuming || metadata?.executionState === "RESUMING"
                    ? "Resuming..."
                    : "Resume test execution"}
                </TooltipContent>
              </Tooltip>
            )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Close workspace"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={handleClose}
                size="icon"
                variant="ghost"
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close workspace</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ─── BROWSER USE LIVE FRAME (Aspect-ratio matching with zero letterbox gaps) ─── */}
      <div
        className="flex flex-1 min-h-0 min-w-0 w-full items-center justify-center overflow-hidden p-2 sm:p-2.5"
        ref={wrapperRef}
      >
        <div
          className={cn(
            "relative flex flex-col overflow-hidden rounded-lg border border-border/40 bg-background shadow-xs",
            fittedDimensions ? "shrink-0" : "flex-1 w-full"
          )}
          ref={containerRef}
          style={
            liveUrl && activeAspectRatio
              ? {
                  aspectRatio: `${activeAspectRatio}`,
                  maxHeight: "100%",
                  maxWidth: "100%",
                  ...(fittedDimensions
                    ? {
                        height: `${fittedDimensions.height}px`,
                        width: `${fittedDimensions.width}px`,
                      }
                    : {
                        height: "100%",
                        width: "100%",
                      }),
                }
              : undefined
          }
        >
          {liveUrl ? (
            <iframe
              allow="clipboard-read; clipboard-write"
              className="absolute inset-0 block h-full w-full border-0 bg-background"
              key={iframeKey}
              src={liveUrl}
              title="Live Browser Session"
            />
          ) : status === "connecting" || isSessionFetching ? (
            <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <Shimmer
                className="text-sm font-medium text-foreground whitespace-normal break-words"
                duration={1.5}
              >
                Connecting to live browser session...
              </Shimmer>
              <p className="text-xs text-muted-foreground max-w-sm">
                Spawning cloud browser instance for {displayHost}...
              </p>
            </div>
          ) : status === "error" ? (
            <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive shadow-xs">
                <AlertCircle className="size-5" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  Browser Connection Failed
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {metadata?.errorMessage ||
                    "Could not connect to the live browser instance."}
                </p>
              </div>
              <Button
                className="mt-2 text-xs"
                onClick={handleRetry}
                size="sm"
                variant="outline"
              >
                <RotateCw className="mr-1.5 size-3.5" />
                Retry Connection
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl border border-border/50 bg-muted/40 text-muted-foreground shadow-xs">
                <Globe className="size-5 opacity-70" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  No Active Browser Session
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Ask the AI to test a website URL or flow (e.g. &quot;Test
                  login on https://example.com&quot;) to launch the live
                  browser.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
