"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Globe,
  Lock,
  Maximize2,
  Minimize2,
  RotateCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  const [iframeKey, setIframeKey] = useState<number>(0);

  // If liveUrl is not in metadata, fetch active session from DB for this chatId
  const shouldFetchSession = !metadata?.liveUrl && Boolean(chatId);
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
  }>(shouldFetchSession ? `/api/qa/session?chatId=${chatId}` : null, fetcher, {
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
  const currentAction = metadata?.currentAction;

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

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

  const handleOpenExternal = useCallback(() => {
    if (liveUrl) {
      window.open(liveUrl, "_blank", "noopener,noreferrer");
    }
  }, [liveUrl]);

  // Extract a clean domain / display title
  const displayHost = (() => {
    try {
      return new URL(currentUrl).hostname;
    } catch {
      return title || "Live Browser";
    }
  })();

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col bg-sidebar select-none transition-all duration-200",
        isFullscreen && "fixed inset-0 z-50 bg-background"
      )}
    >
      {/* ─── 1. TOP BROWSER CHROME (Window Controls + Active Tab + Workspace Actions) ─── */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 bg-sidebar px-3">
        {/* Left: Window dot indicators + Browser Tab */}
        <div className="flex items-center gap-2.5 overflow-hidden">
          {/* Subtle macOS-style window dots */}
          <div className="flex items-center gap-1.5 pl-0.5">
            <span className="size-2.5 rounded-full bg-red-500/70" />
            <span className="size-2.5 rounded-full bg-amber-500/70" />
            <span className="size-2.5 rounded-full bg-emerald-500/70" />
          </div>

          {/* Active Tab */}
          <div className="flex h-8 items-center gap-2 rounded-t-md border-t border-x border-border/50 bg-background/95 px-3 shadow-xs">
            <Globe className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-[160px] truncate text-xs font-medium text-foreground">
              {displayHost}
            </span>

            {/* Live Status indicator */}
            <div className="ml-1 flex items-center gap-1">
              {status === "live" && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              )}
              {status === "working" && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Agent working
                </span>
              )}
              {status === "connecting" && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Connecting
                </span>
              )}
              {status === "idle" && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  Ready
                </span>
              )}
              {status === "error" && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-destructive">
                  <span className="size-1.5 rounded-full bg-destructive" />
                  Error
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Workspace controls */}
        <div className="flex items-center gap-1">
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
              <TooltipContent>Open in external window</TooltipContent>
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Close browser workspace"
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

      {/* ─── 2. BROWSER NAVIGATION BAR (Back, Forward, Refresh, URL Display) ─── */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/40 bg-background px-3">
        {/* Navigation buttons */}
        <div className="flex items-center gap-0.5">
          <Button
            aria-label="Back"
            className="size-7 text-muted-foreground/60 cursor-not-allowed"
            disabled
            size="icon"
            variant="ghost"
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <Button
            aria-label="Forward"
            className="size-7 text-muted-foreground/60 cursor-not-allowed"
            disabled
            size="icon"
            variant="ghost"
          >
            <ArrowRight className="size-3.5" />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Refresh browser view"
                className="size-7 text-muted-foreground hover:text-foreground"
                disabled={!liveUrl}
                onClick={handleRefresh}
                size="icon"
                variant="ghost"
              >
                <RotateCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh view</TooltipContent>
          </Tooltip>
        </div>

        {/* Informational URL Pill */}
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border/50 bg-muted/30 px-3 py-1 text-xs text-muted-foreground shadow-xs">
          <Lock className="size-3 shrink-0 text-emerald-500/80" />
          <span className="truncate font-mono text-[11px] text-foreground/90 select-all">
            {currentUrl}
          </span>
        </div>
      </div>

      {/* ─── 3. SUBTLE ACTION TICKER (Agent Activity) ─── */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/30 bg-muted/20 px-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2 overflow-hidden">
          {status === "working" ? (
            <div className="flex items-center gap-1.5 text-amber-500">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
              <span className="font-medium truncate">
                {currentAction || "Agent is interacting with application..."}
              </span>
            </div>
          ) : status === "live" ? (
            <div className="flex items-center gap-1.5 text-emerald-500/90">
              <CheckCircle2 className="size-3" />
              <span className="truncate">Browser session active</span>
            </div>
          ) : status === "connecting" ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
              <span>Connecting to cloud browser...</span>
            </div>
          ) : status === "error" ? (
            <div className="flex items-center gap-1.5 text-destructive">
              <AlertCircle className="size-3" />
              <span>{metadata?.errorMessage || "Session disconnected"}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
              <span>Ready for QA tasks</span>
            </div>
          )}
        </div>

        {metadata?.recentSteps && metadata.recentSteps.length > 0 && (
          <div className="shrink-0 text-[10px] text-muted-foreground/70">
            Step {metadata.recentSteps.length}
          </div>
        )}
      </div>

      {/* ─── 4. LIVE BROWSER VIEWPORT ─── */}
      <div className="relative flex-1 bg-muted/10 overflow-hidden">
        {liveUrl ? (
          <iframe
            allow="clipboard-read; clipboard-write"
            className="h-full w-full border-0 bg-background"
            key={iframeKey}
            src={liveUrl}
            title="Live Reality Browser Preview"
          />
        ) : status === "connecting" || isSessionFetching ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="relative flex size-12 items-center justify-center rounded-2xl border border-border/50 bg-background shadow-sm">
              <RotateCw className="size-5 animate-spin text-amber-500" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                Connecting to Browser Session
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Spawning cloud browser instance for {displayHost}...
              </p>
            </div>
          </div>
        ) : status === "error" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 text-destructive shadow-sm">
              <AlertCircle className="size-6" />
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
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-border/50 bg-background text-muted-foreground shadow-sm">
              <Globe className="size-6 opacity-60" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                No Active Browser Session
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Ask the AI to test a website URL or flow (e.g. &quot;Test login
                on https://example.com&quot;) to launch the live browser.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
