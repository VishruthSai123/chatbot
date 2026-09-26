"use client";

import {
  AlertCircle,
  ExternalLink,
  Globe,
  Maximize2,
  Minimize2,
  RotateCw,
  Scaling,
  Square,
  X,
  ZoomIn,
  ZoomOut,
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
  liveUrl?: string;
  targetUrl?: string;
  currentUrl?: string;
  status?: BrowserStatus;
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
  const { chatId } = useActiveChat();
  const { setArtifact } = useArtifact();
  const [iframeKey] = useState<number>(0);
  const [isStopping, setIsStopping] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [viewMode, setViewMode] = useState<"fill" | "fit">("fill");
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerDimensions, setContainerDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerDimensions({
            height: Math.round(height),
            width: Math.round(width),
          });
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // If liveUrl is not in metadata, fetch active session from DB for this chatId
  const shouldFetchSession = !metadata?.liveUrl && Boolean(chatId);
  const sessionQuery = useMemo(() => {
    if (!shouldFetchSession) {
      return null;
    }
    const params = new URLSearchParams({ chatId: chatId ?? "" });
    if (containerDimensions) {
      params.set("width", String(containerDimensions.width));
      params.set("height", String(containerDimensions.height));
    }
    return `/api/qa/session?${params.toString()}`;
  }, [shouldFetchSession, chatId, containerDimensions]);

  const {
    data: sessionData,
    error: sessionFetchError,
    isLoading: isSessionFetching,
    mutate: mutateSession,
  } = useSWR<{
    session: {
      id: string;
      browserSessionId: string;
      liveUrl: string | null;
      targetUrl: string;
      status: string;
    } | null;
  }>(sessionQuery, fetcher, {
    revalidateOnFocus: false,
  });

  // Sync DB session into metadata if found
  useEffect(() => {
    if (sessionData?.session?.liveUrl && setMetadata) {
      const s = sessionData.session;
      setMetadata((prev) => ({
        ...prev,
        browserSessionId: s.browserSessionId,
        liveUrl: s.liveUrl ?? undefined,
        status:
          (s.status === "active" ? "live" : (s.status as BrowserStatus)) ??
          "live",
        targetUrl: s.targetUrl,
      }));
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
  const status: BrowserStatus = sessionFetchError ? "error" : rawStatus;
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

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(0.8, Number((prev - 0.1).toFixed(2))));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(1.6, Number((prev + 0.1).toFixed(2))));
  }, []);

  const handleToggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "fill" ? "fit" : "fill"));
  }, []);

  // Compute effective scale:
  // In "fill" mode, auto-expand so the stream reaches 100% of the container
  // with zero letterboxing or pillarboxing borders, multiplied by user zoom.
  const effectiveScale = useMemo(() => {
    let scale = zoom;
    if (viewMode === "fill" && containerDimensions) {
      const containerRatio =
        containerDimensions.width / Math.max(1, containerDimensions.height);
      // Baseline stream ratio is ~1.234 (1024 / 830)
      const streamRatio = 1.234;
      const autoFillRatio =
        containerRatio > streamRatio
          ? containerRatio / streamRatio
          : streamRatio / containerRatio;
      const fillFactor = Math.min(1.6, Math.max(1.0, autoFillRatio));
      scale = Number((scale * fillFactor).toFixed(3));
    }
    return scale;
  }, [viewMode, containerDimensions, zoom]);

  const handleRetry = useCallback(() => {
    mutateSession();
  }, [mutateSession]);

  const handleStopSession = useCallback(async () => {
    if (!chatId || isStopping) {
      return;
    }
    setIsStopping(true);
    try {
      await fetch(`/api/qa/session?chatId=${chatId}`, { method: "DELETE" });
      mutateSession();
      setMetadata?.((prev) => ({
        ...prev,
        currentAction: "Session stopped by user",
        status: "stopped",
      }));
    } catch (err) {
      console.error("[BrowserPreview] Error stopping session:", err);
    } finally {
      setIsStopping(false);
    }
  }, [chatId, isStopping, mutateSession, setMetadata]);

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
              {status === "live" && (
                <span className="flex items-center gap-1 font-medium text-emerald-500">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              )}
              {status === "working" && (
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Agent working
                </span>
              )}
              {status === "connecting" && (
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Connecting
                </span>
              )}
              {status === "idle" && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  Ready
                </span>
              )}
              {status === "error" && (
                <span className="flex items-center gap-1 font-medium text-destructive">
                  <span className="size-1.5 rounded-full bg-destructive" />
                  Error
                </span>
              )}
              {status === "stopped" && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  Stopped
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Essential Workspace Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Zoom controls to magnify content and clip letterbox margins */}
          {liveUrl ? (
            <div className="flex items-center rounded-md border border-border/40 bg-muted/40 px-1 py-0.5 mr-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Zoom out"
                    className="size-5 p-0 text-muted-foreground hover:text-foreground"
                    disabled={zoom <= 0.8}
                    onClick={handleZoomOut}
                    size="icon"
                    variant="ghost"
                  >
                    <ZoomOut className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom out</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="px-1.5 text-[11px] font-mono font-medium text-muted-foreground hover:text-foreground select-none cursor-pointer"
                    onClick={handleZoomReset}
                    type="button"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                </TooltipTrigger>
                <TooltipContent>Reset zoom (100%)</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Zoom in"
                    className="size-5 p-0 text-muted-foreground hover:text-foreground"
                    disabled={zoom >= 1.6}
                    onClick={handleZoomIn}
                    size="icon"
                    variant="ghost"
                  >
                    <ZoomIn className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Zoom in (enlarge & clip margins)
                </TooltipContent>
              </Tooltip>

              <div className="mx-1 h-3.5 w-px bg-border/40" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={
                      viewMode === "fill"
                        ? "Switch to Fit mode"
                        : "Switch to Fill mode"
                    }
                    className={cn(
                      "h-5 px-1.5 text-[10px] font-medium transition-colors",
                      viewMode === "fill"
                        ? "bg-accent text-accent-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={handleToggleViewMode}
                    size="sm"
                    variant="ghost"
                  >
                    <Scaling className="mr-1 size-3" />
                    {viewMode === "fill" ? "Fill" : "Fit"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {viewMode === "fill"
                    ? "Fill area (eliminates black borders, click for Fit)"
                    : "Fit area (shows whole view, click for Fill)"}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}

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

          {(status === "live" || status === "working") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Stop browser session"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={isStopping}
                  onClick={handleStopSession}
                  size="icon"
                  variant="ghost"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop browser session</TooltipContent>
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

      {/* ─── BROWSER USE LIVE FRAME (Filling available space) ─── */}
      <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden p-2 sm:p-2.5">
        <div
          className="relative flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-lg border border-border/40 bg-background shadow-xs"
          ref={containerRef}
        >
          {liveUrl ? (
            <div
              className="absolute inset-0 h-full w-full overflow-hidden transition-transform duration-150 ease-out origin-top"
              style={{
                transform:
                  effectiveScale === 1 ? undefined : `scale(${effectiveScale})`,
              }}
            >
              <iframe
                allow="clipboard-read; clipboard-write"
                className="h-full w-full border-0 bg-background"
                key={iframeKey}
                src={liveUrl}
                title="Live Browser Session"
              />
            </div>
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
