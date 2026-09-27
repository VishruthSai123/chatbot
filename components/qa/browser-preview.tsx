"use client";

import {
  AlertCircle,
  ExternalLink,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorOff,
  Play,
  RotateCcw,
  RotateCw,
  Square,
  WifiOff,
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
import {
  type CanonicalExecutionState,
  type DownloadItem,
  isTerminalExecutionState,
} from "@/lib/qa/execution-types";
import { cn, fetcher } from "@/lib/utils";
import { Shimmer } from "../ai-elements/shimmer";

export type CanonicalPreviewState =
  | "BROWSER_SESSION_STARTING"
  | "BROWSER_SESSION_READY"
  | "LIVE_VIEW_DISCONNECTED"
  | "BROWSER_SESSION_ENDED"
  | "BROWSER_SESSION_START_FAILED"
  | "NO_ACTIVE_SESSION";

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
  downloads?: DownloadItem[];
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
  const [iframeKey, setIframeKey] = useState<number>(0);
  const [isStopping, setIsStopping] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const isRestartingRef = useRef(false);
  const activeBrowserSessionIdRef = useRef<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wrapperRef.current) {
      return;
    }
    let timeoutId: NodeJS.Timeout | null = null;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          timeoutId = setTimeout(() => {
            const rounded = {
              height: Math.round(height),
              width: Math.round(width),
            };
            setBrowserDimensions?.((prev) => {
              if (
                prev &&
                Math.abs(prev.width - rounded.width) < 40 &&
                Math.abs(prev.height - rounded.height) < 40
              ) {
                return prev;
              }
              return rounded;
            });
          }, 300);
        }
      }
    });
    ro.observe(wrapperRef.current);
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      ro.disconnect();
    };
  }, [setBrowserDimensions]);

  const isExecuting =
    metadata?.executionState === "STARTING" ||
    metadata?.executionState === "RUNNING" ||
    metadata?.executionState === "WAITING" ||
    metadata?.executionState === "FINALIZING" ||
    metadata?.executionState === "CANCELLING" ||
    metadata?.executionState === "RESUMING" ||
    metadata?.status === "working";

  // Use unified sessionQuery so SWR deduplicates with ChatShell and ChatHeader
  const sessionQuery = useMemo(() => {
    if (!chatId) {
      return null;
    }
    return `/api/qa/session?chatId=${chatId}`;
  }, [chatId]);

  const [liveViewStatus, setLiveViewStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [restartError, setRestartError] = useState<string | null>(null);

  // Network connectivity tracking
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  const {
    data: sessionData,
    error: sessionFetchError,
    isLoading: isSessionFetching,
    mutate: mutateSession,
  } = useSWR<{
    finding?: any;
    session: {
      id: string;
      browserSessionId: string;
      browserScreenHeight?: number;
      browserScreenWidth?: number;
      isEnded?: boolean;
      liveUrl: string | null;
      status: string;
      targetUrl: string;
    } | null;
    execution: any;
  }>(sessionQuery, fetcher, {
    errorRetryInterval: 2500,
    refreshInterval: (latestData) => {
      if (latestData?.session?.isEnded) {
        return 0;
      }
      if (!isOnline) {
        return 3000;
      }
      const execState = latestData?.execution?.executionState;
      const isRemoteActive =
        execState === "STARTING" ||
        execState === "RUNNING" ||
        execState === "WAITING" ||
        execState === "FINALIZING" ||
        execState === "RESUMING";
      return isRemoteActive ? 2500 : 5000;
    },
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    shouldRetryOnError: true,
  });

  // Listen for live-view connection events from embedded live.browser-use.com
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const { data } = event;
        if (!data) {
          return;
        }
        const payload = typeof data === "string" ? JSON.parse(data) : data;

        const connStatus =
          payload?.connectionStatus ??
          payload?.status ??
          payload?.state ??
          payload?.type;

        if (
          connStatus === "disconnected" ||
          connStatus === "connection_failed" ||
          payload?.event === "disconnected" ||
          payload?.error?.includes?.("502") ||
          payload?.error?.includes?.("503") ||
          payload?.error?.includes?.("Failed to fetch version")
        ) {
          console.log(
            `[BrowserPreview] Live view message received: disconnected (${payload?.error ?? connStatus})`
          );
          setLiveViewStatus("disconnected");
        } else if (
          connStatus === "connected" ||
          connStatus === "ready" ||
          payload?.event === "connected"
        ) {
          setLiveViewStatus("connected");
        }
      } catch {
        // Non-JSON message from other sources, ignore
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (sessionData?.session?.browserSessionId && !isRestartingRef.current) {
    activeBrowserSessionIdRef.current = sessionData.session.browserSessionId;
  }

  const isBackendActive =
    sessionData?.execution?.executionState === "STARTING" ||
    sessionData?.execution?.executionState === "RUNNING" ||
    sessionData?.execution?.executionState === "WAITING" ||
    sessionData?.execution?.executionState === "FINALIZING" ||
    sessionData?.execution?.executionState === "RESUMING";

  const isNetworkInterrupted =
    !isOnline ||
    (Boolean(sessionFetchError) && (isExecuting || isBackendActive));

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      mutateSession();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [mutateSession]);

  // Sync DB session and execution into metadata if found
  useEffect(() => {
    if (isRestartingRef.current) {
      return;
    }

    if (sessionData?.session?.isEnded && setMetadata) {
      setMetadata((prev) => {
        if (!prev?.liveUrl) {
          return prev ?? {};
        }
        return {
          ...prev,
          liveUrl: undefined,
        };
      });
    }

    if (sessionData?.session?.liveUrl && setMetadata) {
      const s = sessionData.session;
      const exec = sessionData.execution;
      const f = sessionData.finding;
      setMetadata((prev) => {
        const safePrev = prev ?? {};

        const isSameRun =
          !exec?.runId || !safePrev?.runId || exec.runId === safePrev.runId;
        const isNewerSequence = Boolean(
          exec?.sequence &&
            safePrev?.sequence &&
            exec.sequence > safePrev.sequence
        );
        const isResumingOrStarting =
          exec?.executionState === "RESUMING" ||
          exec?.executionState === "STARTING" ||
          exec?.executionState === "RUNNING";

        // Only block regression from CANCELLED if it's the exact same run and not newer/resuming
        if (
          (safePrev.executionState === "CANCELLED" ||
            safePrev.executionState === "CANCELLING") &&
          exec?.executionState !== "CANCELLED" &&
          isSameRun &&
          !isNewerSequence &&
          !isResumingOrStarting
        ) {
          return safePrev;
        }

        // Monotonic sequence check for same run
        if (
          isSameRun &&
          safePrev.sequence &&
          exec?.sequence &&
          exec.sequence < safePrev.sequence
        ) {
          return safePrev;
        }

        const isTerminal = isTerminalExecutionState(exec?.executionState);
        const computedStatus =
          exec?.executionState === "COMPLETED"
            ? "idle"
            : exec?.executionState === "FAILED" ||
                exec?.executionState === "TIMED_OUT"
              ? "error"
              : exec?.executionState === "CANCELLED"
                ? "stopped"
                : "working";

        return {
          ...safePrev,
          browserScreenHeight:
            s.browserScreenHeight ?? safePrev.browserScreenHeight,
          browserScreenWidth:
            s.browserScreenWidth ?? safePrev.browserScreenWidth,
          browserSessionId: s.browserSessionId,
          liveUrl: s.liveUrl ?? undefined,
          status: isTerminal
            ? computedStatus
            : ((s.status === "active" ? "live" : (s.status as BrowserStatus)) ??
              safePrev.status ??
              "live"),
          targetUrl: s.targetUrl,
          ...(f
            ? {
                finding: f,
                findingId: f.findingId || safePrev.findingId,
                verdict: f.status || safePrev.verdict,
              }
            : {}),
          ...(exec
            ? {
                currentAction: exec.currentAction || safePrev.currentAction,
                downloads: exec.downloads || safePrev.downloads,
                errorMessage: exec.error || safePrev.errorMessage,
                executionState: exec.executionState || safePrev.executionState,
                findingId: exec.findingId || f?.findingId || safePrev.findingId,
                recentSteps: exec.steps || safePrev.recentSteps,
                runId: exec.runId || safePrev.runId,
                sequence: exec.sequence || safePrev.sequence,
                verdict: exec.verdict || f?.status || safePrev.verdict,
              }
            : {}),
        };
      });
    }
  }, [sessionData, setMetadata]);

  const isSessionEnded = Boolean(
    sessionData?.session?.isEnded && !isRestarting
  );

  const liveUrl = isSessionEnded
    ? null
    : (sessionData?.session?.liveUrl ?? metadata?.liveUrl ?? null);
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
    metadata?.executionState === "FAILED"
      ? "error"
      : metadata?.executionState === "CANCELLED"
        ? "stopped"
        : rawStatus;
  const isFullscreen = Boolean(metadata?.isFullscreen);

  useEffect(() => {
    if (liveUrl) {
      setLiveViewStatus("connecting");
    }
  }, [liveUrl]);

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
    setArtifact((prev: any) => ({
      ...prev,
      isVisible: false,
    }));
  }, [setArtifact]);

  const handleRetry = useCallback(() => {
    setRestartError(null);
    mutateSession();
  }, [mutateSession]);

  const handleReloadIframe = useCallback(() => {
    setLiveViewStatus("connecting");
    setIframeKey((k) => k + 1);
    mutateSession();
  }, [mutateSession]);

  const handleReconnectLiveView = useCallback(() => {
    console.log(
      `[BrowserRecovery] Action=reconnect_live_view, sessionId=${activeBrowserSessionIdRef.current ?? "none"}, reason=live_view_disconnected`
    );
    setLiveViewStatus("connecting");
    setIframeKey((k) => k + 1);
    mutateSession();
  }, [mutateSession]);

  const handleSyncSession = useCallback(() => {
    mutateSession();
  }, [mutateSession]);

  const canonicalState: CanonicalPreviewState = useMemo(() => {
    if (isRestarting) {
      return "BROWSER_SESSION_STARTING";
    }
    if (restartError) {
      return "BROWSER_SESSION_START_FAILED";
    }
    if (isSessionEnded) {
      return "BROWSER_SESSION_ENDED";
    }
    if (liveUrl) {
      if (liveViewStatus === "disconnected") {
        return "LIVE_VIEW_DISCONNECTED";
      }
      return "BROWSER_SESSION_READY";
    }
    if (
      status === "connecting" ||
      isSessionFetching ||
      metadata?.executionState === "STARTING" ||
      sessionData?.session?.status === "initializing"
    ) {
      return "BROWSER_SESSION_STARTING";
    }
    if (status === "error") {
      return "BROWSER_SESSION_START_FAILED";
    }
    return "NO_ACTIVE_SESSION";
  }, [
    isRestarting,
    restartError,
    isSessionEnded,
    liveUrl,
    liveViewStatus,
    status,
    isSessionFetching,
    metadata?.executionState,
    sessionData?.session?.status,
  ]);

  const prevCanonicalStateRef = useRef<CanonicalPreviewState | null>(null);
  useEffect(() => {
    if (prevCanonicalStateRef.current !== canonicalState) {
      prevCanonicalStateRef.current = canonicalState;
      console.log(
        `[BrowserPreview] sessionId=${sessionData?.session?.browserSessionId ?? metadata?.browserSessionId ?? "none"}, liveUrl=${Boolean(liveUrl)}, connectionState=${liveViewStatus}, renderState=${canonicalState}`
      );
    }
  }, [
    canonicalState,
    sessionData?.session?.browserSessionId,
    metadata?.browserSessionId,
    liveUrl,
    liveViewStatus,
  ]);

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

  const handleRestartBrowser = useCallback(async () => {
    if (!chatId || isRestartingRef.current) {
      return;
    }
    isRestartingRef.current = true;
    setIsRestarting(true);
    setRestartError(null);
    const oldSessionId = activeBrowserSessionIdRef.current;

    console.log(
      `[BrowserRecovery] Action=restart_browser, oldSessionId=${oldSessionId ?? "none"}, targetUrl=${targetUrl}`
    );

    try {
      const res = await fetch("/api/qa/session", {
        body: JSON.stringify({
          action: "restart",
          browserScreenHeight: browserDimensions?.height,
          browserScreenWidth: browserDimensions?.width,
          chatId,
          targetUrl,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(
          `Failed to restart browser session: HTTP ${res.status}`
        );
      }

      const data = await res.json();
      if (data?.session) {
        const newSession = data.session;
        activeBrowserSessionIdRef.current = newSession.browserSessionId;
        console.log(
          `[BrowserRecovery] Restart success: oldSessionId=${oldSessionId ?? "none"}, newSessionId=${newSession.browserSessionId}`
        );

        setLiveViewStatus("connecting");

        // Synchronously update SWR cache so neither preview nor chat shell flashes stale state
        await mutateSession(
          (prev) => ({
            execution: prev?.execution ?? null,
            finding: prev?.finding,
            session: {
              ...(prev?.session ?? {}),
              ...newSession,
              isEnded: false,
              liveUrl: newSession.liveUrl,
              status: "active",
            },
          }),
          false
        );

        setMetadata?.((prev) => ({
          ...(prev ?? {}),
          browserScreenHeight:
            newSession.browserScreenHeight ?? prev?.browserScreenHeight,
          browserScreenWidth:
            newSession.browserScreenWidth ?? prev?.browserScreenWidth,
          browserSessionId: newSession.browserSessionId,
          errorMessage: undefined,
          liveUrl: newSession.liveUrl ?? undefined,
          status: "live",
        }));

        setIframeKey((k) => k + 1);
      }
    } catch (err: any) {
      console.error("[BrowserPreview] Error restarting browser session:", err);
      setRestartError(err?.message || "Failed to restart browser session");
    } finally {
      setIsRestarting(false);
      isRestartingRef.current = false;
    }
  }, [chatId, browserDimensions, targetUrl, mutateSession, setMetadata]);

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
              {isNetworkInterrupted ? (
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Reconnecting…
                </span>
              ) : canonicalState === "BROWSER_SESSION_STARTING" ||
                isRestarting ? (
                <span className="flex items-center gap-1 font-medium text-blue-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
                  Starting session…
                </span>
              ) : isStopping || metadata?.executionState === "CANCELLING" ? (
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Cancelling…
                </span>
              ) : isResuming || metadata?.executionState === "RESUMING" ? (
                <span className="flex items-center gap-1 font-medium text-blue-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
                  Resuming…
                </span>
              ) : canonicalState === "LIVE_VIEW_DISCONNECTED" ? (
                <span className="flex items-center gap-1 font-medium text-amber-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Stream disconnected
                </span>
              ) : canonicalState === "BROWSER_SESSION_ENDED" ? (
                <span className="flex items-center gap-1 font-medium text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                  Ended
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
              ) : status === "error" ||
                canonicalState === "BROWSER_SESSION_START_FAILED" ? (
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
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Reload browser view"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    onClick={handleReloadIframe}
                    size="icon"
                    variant="ghost"
                  >
                    <RotateCw className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reload browser view</TooltipContent>
              </Tooltip>

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
            </>
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
          {!isSessionEnded &&
            (status === "live" || status === "working" || isStopping) &&
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
          {!isSessionEnded &&
            (metadata?.executionState === "CANCELLED" ||
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

      {/* ─── NETWORK INTERRUPTED NOTIFICATION BANNER ─── */}
      {isNetworkInterrupted ? (
        <div className="flex items-center justify-between gap-2 px-3.5 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs shrink-0 select-text">
          <div className="flex items-center gap-2 truncate">
            <Loader2 className="size-3.5 animate-spin shrink-0 text-amber-500" />
            <span className="truncate">
              Connection interrupted — your test is still running. Reconnecting…
            </span>
          </div>
          <button
            className="text-[11px] font-medium underline hover:text-foreground shrink-0 cursor-pointer"
            onClick={handleSyncSession}
            type="button"
          >
            Sync State
          </button>
        </div>
      ) : null}

      {/* ─── BROWSER USE LIVE FRAME (Aspect-ratio matching with zero letterbox gaps) ─── */}
      <div
        className="flex flex-1 min-h-0 min-w-0 w-full items-center justify-center overflow-hidden p-2 sm:p-2.5"
        ref={wrapperRef}
      >
        <div
          className={cn(
            "relative flex flex-col overflow-hidden rounded-lg border border-border/40 bg-background shadow-xs",
            liveUrl && canonicalState === "BROWSER_SESSION_READY"
              ? "max-h-full max-w-full h-full w-auto"
              : "flex-1 w-full"
          )}
          ref={containerRef}
          style={
            liveUrl &&
            canonicalState === "BROWSER_SESSION_READY" &&
            activeAspectRatio
              ? {
                  aspectRatio: `${activeAspectRatio}`,
                }
              : undefined
          }
        >
          {canonicalState === "BROWSER_SESSION_ENDED" ? (
            <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center animate-in fade-in-0 zoom-in-95 duration-200">
              <div className="flex size-10 items-center justify-center rounded-xl border border-border/50 bg-muted/40 text-muted-foreground shadow-xs">
                <MonitorOff className="size-5 opacity-70" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  Browser session ended
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Start a new session to continue testing.
                </p>
              </div>
              <Button
                className="mt-1 h-8 px-3 text-xs gap-1.5"
                disabled={isRestarting}
                onClick={handleRestartBrowser}
                size="sm"
              >
                {isRestarting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                <span>
                  {isRestarting ? "Starting session..." : "Restart browser"}
                </span>
              </Button>
            </div>
          ) : canonicalState === "LIVE_VIEW_DISCONNECTED" ? (
            <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center animate-in fade-in-0 zoom-in-95 duration-200">
              <div className="flex size-10 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-500 shadow-xs">
                <WifiOff className="size-5" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  Live Stream Interrupted
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  The browser session is still running in the cloud. CDP
                  connection to the live view was interrupted.
                </p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={handleReconnectLiveView}
                  size="sm"
                  variant="outline"
                >
                  <RotateCw className="size-3.5" />
                  <span>Reconnect live view</span>
                </Button>
                {liveUrl ? (
                  <Button
                    className="h-8 px-3 text-xs gap-1.5"
                    onClick={handleOpenExternal}
                    size="sm"
                    variant="ghost"
                  >
                    <ExternalLink className="size-3.5" />
                    <span>Open in new tab</span>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : canonicalState === "BROWSER_SESSION_READY" && liveUrl ? (
            <iframe
              allow="clipboard-read; clipboard-write"
              className="absolute inset-0 block h-full w-full border-0 bg-background animate-in fade-in-0 zoom-in-95 duration-200"
              key={iframeKey}
              src={liveUrl}
              title="Live Browser Session"
            />
          ) : canonicalState === "BROWSER_SESSION_STARTING" ? (
            <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center animate-in fade-in-0 zoom-in-95 duration-200">
              <Shimmer
                className="text-sm font-medium text-foreground whitespace-normal break-words"
                duration={1.5}
              >
                {isRestarting
                  ? "Starting new browser session..."
                  : "Connecting to live browser session..."}
              </Shimmer>
              <p className="text-xs text-muted-foreground max-w-sm">
                Spawning cloud browser instance for {displayHost}...
              </p>
            </div>
          ) : canonicalState === "BROWSER_SESSION_START_FAILED" ? (
            <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive shadow-xs">
                <AlertCircle className="size-5" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  Browser Connection Failed
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {restartError ||
                    metadata?.errorMessage ||
                    "Could not connect to the live browser instance."}
                </p>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Button
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={handleRestartBrowser}
                  size="sm"
                >
                  <RotateCcw className="size-3.5" />
                  <span>Restart browser</span>
                </Button>
                <Button
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={handleRetry}
                  size="sm"
                  variant="outline"
                >
                  <RotateCw className="size-3.5" />
                  <span>Retry Connection</span>
                </Button>
              </div>
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
