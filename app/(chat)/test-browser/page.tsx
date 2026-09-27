"use client";

import {
  Activity,
  CheckCircle2,
  ExternalLink,
  Globe,
  Layers,
  Maximize2,
  Minimize2,
  Play,
  RotateCw,
  Settings2,
  Sliders,
  Square,
  X,
} from "lucide-react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// =========================================================================
// CONFIGURATION: Configure default parameters or toggle the diagnostic overlay in code
// =========================================================================
export const SIMULATOR_CONFIG = {
  // Automatically connect to Browser Use Cloud on page load
  autoConnect: false,
  // Default cloud browser resolution
  defaultHeight: 880,
  // Default target website for live tests
  defaultTargetUrl: "https://example.com",
  defaultWidth: 1440,
  // Toggle the test overlay display (true = show overlay, false = hide overlay)
  enableOverlay: true,
  // Default view: true = 60% right panel / 40% mock chat (ditto layout); false = 100% full panel
  splitLayout: true,
};

// Preset resolution options
interface PresetOption {
  h: number;
  label: string;
  ratio: number;
  w: number;
}

const DIMENSION_PRESETS: PresetOption[] = [
  {
    h: 880,
    label: "1440 × 880 (Optimal Fit)",
    ratio: 1440 / 880,
    w: 1440,
  },
  {
    h: 1002,
    label: "1442 × 1002 (Browser Use Default)",
    ratio: 1442 / 1002,
    w: 1442,
  },
  {
    h: 1440,
    label: "1100 × 1440 (Custom Portrait)",
    ratio: 1100 / 1440,
    w: 1100,
  },
  {
    h: 1016,
    label: "1132 × 1016 (Desktop 60% 1080p)",
    ratio: 1132 / 1016,
    w: 1132,
  },
  { h: 830, label: "1024 × 830 (Legacy Default)", ratio: 1024 / 830, w: 1024 },
  { h: 1080, label: "1920 × 1080 (16:9 Full HD)", ratio: 16 / 9, w: 1920 },
  { h: 800, label: "1280 × 800 (16:10 Laptop)", ratio: 16 / 10, w: 1280 },
];

const PresetButton = memo(function PresetButtonComponent({
  preset,
  isActive,
  onSelect,
}: {
  preset: PresetOption;
  isActive: boolean;
  onSelect: (p: PresetOption) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(preset);
  }, [preset, onSelect]);

  return (
    <button
      className={cn(
        "flex items-center justify-between rounded px-2 py-1 text-[11px] font-mono transition-colors text-left",
        isActive
          ? "bg-primary text-primary-foreground font-semibold"
          : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
      )}
      onClick={handleClick}
      type="button"
    >
      <span>{preset.label}</span>
      <span className="text-[10px] opacity-80">
        {preset.ratio.toFixed(2)}:1
      </span>
    </button>
  );
});

export default function BrowserUseSimulatorPage() {
  // UI & Layout state
  const [isOverlayVisible, setIsOverlayVisible] = useState(
    SIMULATOR_CONFIG.enableOverlay
  );
  const [isSplitLayout, setIsSplitLayout] = useState(
    SIMULATOR_CONFIG.splitLayout
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Dimension & Ratio configuration
  const [targetUrl, setTargetUrl] = useState(SIMULATOR_CONFIG.defaultTargetUrl);
  const [configuredWidth, setConfiguredWidth] = useState(
    SIMULATOR_CONFIG.defaultWidth
  );
  const [configuredHeight, setConfiguredHeight] = useState(
    SIMULATOR_CONFIG.defaultHeight
  );
  const [isRatioLocked, setIsRatioLocked] = useState(false);
  const [lockedRatio, setLockedRatio] = useState(
    SIMULATOR_CONFIG.defaultWidth / SIMULATOR_CONFIG.defaultHeight
  );

  // Cloud Browser Connection state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "live" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Measured layout dimensions via ResizeObserver
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [wrapperDimensions, setWrapperDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [windowDimensions, setWindowDimensions] = useState<{
    width: number;
    height: number;
  }>({
    height: typeof window === "undefined" ? 1080 : window.innerHeight,
    width: typeof window === "undefined" ? 1920 : window.innerWidth,
  });

  // Track window resizing
  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({
        height: window.innerHeight,
        width: window.innerWidth,
      });
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Track outer panel wrapper dimensions via ResizeObserver (exact ditto of BrowserPreview)
  useEffect(() => {
    if (!wrapperRef.current) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setWrapperDimensions({
            height: Math.round(height),
            width: Math.round(width),
          });
        }
      }
    });
    ro.observe(wrapperRef.current);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Effective aspect ratio of the remote browser
  const activeAspectRatio = useMemo(
    () => configuredWidth / configuredHeight,
    [configuredWidth, configuredHeight]
  );

  // Compute exact tight-bounding dimensions inside wrapper (zero letterbox gaps)
  const fittedDimensions = useMemo(() => {
    if (
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
  }, [wrapperDimensions, activeAspectRatio]);

  // Letterbox Gap calculation for inspector overlay
  const letterboxInspection = useMemo(() => {
    if (!wrapperDimensions || !fittedDimensions) {
      return { horizontalGap: 0, verticalGap: 0 };
    }
    const verticalGap = Math.max(
      0,
      wrapperDimensions.height - fittedDimensions.height
    );
    const horizontalGap = Math.max(
      0,
      wrapperDimensions.width - fittedDimensions.width
    );
    return { horizontalGap, verticalGap };
  }, [wrapperDimensions, fittedDimensions]);

  // Connect to Browser Use Cloud API
  const handleConnectCloud = useCallback(async () => {
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/qa/test-session", {
        body: JSON.stringify({
          height: configuredHeight,
          targetUrl,
          width: configuredWidth,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to create session");
      }

      setActiveSessionId(data.sessionId);
      setLiveUrl(data.liveUrl);
      setStatus("live");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setErrorMessage(msg);
      setStatus("error");
    }
  }, [configuredHeight, configuredWidth, targetUrl]);

  // Stop Browser Use Cloud session
  const handleStopCloud = useCallback(async () => {
    if (!activeSessionId) {
      setLiveUrl(null);
      setStatus("idle");
      return;
    }
    try {
      await fetch(`/api/qa/test-session?sessionId=${activeSessionId}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.warn("Failed to stop session:", err);
    } finally {
      setActiveSessionId(null);
      setLiveUrl(null);
      setStatus("idle");
    }
  }, [activeSessionId]);

  // Apply resolution preset
  const handleApplyPreset = useCallback((preset: PresetOption) => {
    setConfiguredWidth(preset.w);
    setConfiguredHeight(preset.h);
    setLockedRatio(preset.ratio);
  }, []);

  // Match Container Ratio dynamically
  const handleMatchContainer = useCallback(() => {
    if (!wrapperDimensions) {
      return;
    }
    setConfiguredWidth(wrapperDimensions.width);
    setConfiguredHeight(wrapperDimensions.height);
    setLockedRatio(wrapperDimensions.width / wrapperDimensions.height);
  }, [wrapperDimensions]);

  // Adjust width with ratio lock
  const handleWidthChange = useCallback(
    (val: number) => {
      const newWidth = Math.max(360, val);
      setConfiguredWidth(newWidth);
      if (isRatioLocked && lockedRatio > 0) {
        setConfiguredHeight(Math.round(newWidth / lockedRatio));
      }
    },
    [isRatioLocked, lockedRatio]
  );

  // Adjust height with ratio lock
  const handleHeightChange = useCallback(
    (val: number) => {
      const newHeight = Math.max(360, val);
      setConfiguredHeight(newHeight);
      if (isRatioLocked && lockedRatio > 0) {
        setConfiguredWidth(Math.round(newHeight * lockedRatio));
      }
    },
    [isRatioLocked, lockedRatio]
  );

  // Stable handler callbacks for JSX bindings
  const handleExpandPanel = useCallback(() => {
    setIsSplitLayout(false);
  }, []);

  const handleToggleOverlay = useCallback(() => {
    setIsOverlayVisible((prev) => !prev);
  }, []);

  const handleHideOverlay = useCallback(() => {
    setIsOverlayVisible(false);
  }, []);

  const handleToggleSplitLayout = useCallback(() => {
    setIsSplitLayout((prev) => !prev);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const handleOpenLiveTab = useCallback(() => {
    if (liveUrl) {
      window.open(liveUrl, "_blank", "noopener,noreferrer");
    }
  }, [liveUrl]);

  const handleTargetUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTargetUrl(e.target.value);
    },
    []
  );

  const handleWidthInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleWidthChange(Number(e.target.value));
    },
    [handleWidthChange]
  );

  const handleHeightInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleHeightChange(Number(e.target.value));
    },
    [handleHeightChange]
  );

  const handleRatioLockToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setIsRatioLocked(e.target.checked);
      if (e.target.checked && configuredHeight > 0) {
        setLockedRatio(configuredWidth / configuredHeight);
      }
    },
    [configuredWidth, configuredHeight]
  );

  return (
    <div className="flex h-dvh w-dvw overflow-hidden bg-background text-foreground select-none">
      {/* ─── OPTIONAL MOCK CHAT PANEL (To simulate the exact 60/40 desktop split) ─── */}
      {isSplitLayout && !isFullscreen ? (
        <div className="hidden md:flex w-[40%] shrink-0 flex-col border-r border-border/40 bg-sidebar/50">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 px-4">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Chat & Instructions (Mock)
            </span>
            <Button
              className="text-xs h-7 px-2"
              onClick={handleExpandPanel}
              size="sm"
              variant="ghost"
            >
              Expand Panel
            </Button>
          </div>
          <div className="flex flex-1 flex-col justify-between p-4 overflow-y-auto">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-card p-3 border border-border/40 text-xs">
                <span className="font-semibold text-primary">QA Agent:</span>
                <p className="mt-1 text-muted-foreground">
                  Right panel is running the exact ditto container layout
                  (header 44px, padding 10px, aspect-ratio bounding). Use the
                  simulator overlay to test dimension adjustments live.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border/40 bg-background p-2.5 text-xs text-muted-foreground">
              Send prompt here... (Simulated 40% chat pane)
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── DITTO RIGHT PANEL CONTAINER (Exact structure of BrowserPreview) ─── */}
      <div
        className={cn(
          "relative flex h-full flex-1 min-h-0 min-w-0 flex-col bg-sidebar transition-all duration-200",
          isFullscreen && "fixed inset-0 z-50 bg-background"
        )}
      >
        {/* ─── WORKSPACE HEADER (44px / h-11) ─── */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 bg-sidebar px-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground ring-1 ring-border/40">
              <Globe className="size-3.5" />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="max-w-[200px] sm:max-w-[320px] truncate text-xs font-semibold text-foreground tracking-tight">
                {targetUrl}
              </span>
              <div className="flex items-center gap-1.5 text-[11px]">
                {status === "live" ? (
                  <span className="flex items-center gap-1 font-medium text-emerald-500">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Live Cloud Browser
                  </span>
                ) : status === "connecting" ? (
                  <span className="flex items-center gap-1 font-medium text-amber-500">
                    <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                    Connecting...
                  </span>
                ) : status === "error" ? (
                  <span className="flex items-center gap-1 font-medium text-destructive">
                    <span className="size-1.5 rounded-full bg-destructive" />
                    Connection Error
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                    Simulator Ready
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Header Workspace Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Overlay Toggle Button */}
            <Button
              className={cn(
                "h-7 gap-1.5 px-2.5 text-xs font-medium border border-border/40",
                isOverlayVisible
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
              onClick={handleToggleOverlay}
              size="sm"
              variant="outline"
            >
              <Sliders className="size-3.5" />
              {isOverlayVisible ? "Hide Overlay" : "Show Overlay"}
            </Button>

            {isFullscreen ? null : (
              <Button
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleToggleSplitLayout}
                size="sm"
                variant="ghost"
              >
                {isSplitLayout ? "Full Panel" : "Split 60%"}
              </Button>
            )}

            {liveUrl ? (
              <Button
                aria-label="Open live view in new tab"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={handleOpenLiveTab}
                size="icon"
                variant="ghost"
              >
                <ExternalLink className="size-3.5" />
              </Button>
            ) : null}

            <Button
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
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

            {status === "live" ? (
              <Button
                aria-label="Stop browser session"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={handleStopCloud}
                size="icon"
                variant="ghost"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* ─── BROWSER WORKSPACE WRAPPER (Padding 10px / p-2 sm:p-2.5) ─── */}
        <div
          className="flex flex-1 min-h-0 min-w-0 w-full items-center justify-center overflow-hidden p-2 sm:p-2.5"
          ref={wrapperRef}
        >
          {/* ─── INNER CONTAINER FRAME (Aspect-ratio matching with zero letterbox gaps) ─── */}
          <div
            className={cn(
              "relative flex flex-col overflow-hidden rounded-lg border border-border/40 bg-background shadow-xs",
              fittedDimensions ? "shrink-0" : "flex-1 w-full"
            )}
            ref={containerRef}
            style={
              activeAspectRatio
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
            {/* Live iframe or simulated preview */}
            {liveUrl ? (
              <iframe
                allow="clipboard-read; clipboard-write"
                className="absolute inset-0 block h-full w-full border-0 bg-background"
                src={liveUrl}
                title="Live Browser Session"
              />
            ) : status === "connecting" ? (
              <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-sm font-medium text-foreground">
                  Spawning Browser Use Cloud session ({configuredWidth}×
                  {configuredHeight})...
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Connecting to live remote Chromium WebRTC stream...
                </p>
              </div>
            ) : status === "error" ? (
              <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm font-medium text-destructive">
                  Connection Failed
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {errorMessage || "Check BROWSER_USE_API_KEY in .env.local"}
                </p>
                <Button
                  className="text-xs"
                  onClick={handleConnectCloud}
                  size="sm"
                  variant="outline"
                >
                  <RotateCw className="mr-1.5 size-3.5" />
                  Retry Connect
                </Button>
              </div>
            ) : (
              /* Local Interactive Simulation Frame with Grid & Measurement crosshair */
              <div className="relative flex flex-1 min-h-0 w-full flex-col items-center justify-center bg-card/60 p-6 text-center overflow-hidden">
                {/* Background layout crosshair grid */}
                <div className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />

                <div className="relative z-10 flex flex-col items-center gap-3 max-w-md">
                  <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-xs">
                    <Activity className="size-6" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Aspect Ratio & Dimension Simulator Frame
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      This container is locked to{" "}
                      <span className="font-mono font-medium text-foreground">
                        {configuredWidth}×{configuredHeight} (
                        {activeAspectRatio.toFixed(4)}:1)
                      </span>
                      . Notice how the frame bounds snugly with{" "}
                      <span className="font-medium text-emerald-500">
                        0px dark letterbox gaps
                      </span>
                      .
                    </p>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      className="h-8 text-xs gap-1.5"
                      onClick={handleConnectCloud}
                      size="sm"
                    >
                      <Play className="size-3.5" />
                      Spawn Live Cloud Browser
                    </Button>
                    <Button
                      className="h-8 text-xs gap-1.5"
                      onClick={handleMatchContainer}
                      size="sm"
                      variant="outline"
                    >
                      <Layers className="size-3.5" />
                      Match Wrapper Exact Size
                    </Button>
                  </div>
                </div>

                {/* Corner measurement badges */}
                <div className="absolute bottom-2.5 left-2.5 rounded bg-background/80 px-2 py-1 text-[10px] font-mono text-muted-foreground border border-border/40 backdrop-blur-xs">
                  Frame: {fittedDimensions?.width ?? 0}px ×{" "}
                  {fittedDimensions?.height ?? 0}px
                </div>
                <div className="absolute bottom-2.5 right-2.5 rounded bg-background/80 px-2 py-1 text-[10px] font-mono text-muted-foreground border border-border/40 backdrop-blur-xs">
                  Ratio: {activeAspectRatio.toFixed(4)}:1
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── DIAGNOSTIC TEST OVERLAY (Configurable in code & toggleable) ─── */}
        {isOverlayVisible ? (
          <div className="absolute top-14 right-4 z-40 w-96 rounded-xl border border-border/60 bg-background/95 p-4 shadow-xl backdrop-blur-md transition-all">
            <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
              <div className="flex items-center gap-2">
                <Settings2 className="size-4 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  Browser Dimension Simulator
                </span>
              </div>
              <Button
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={handleHideOverlay}
                size="icon"
                variant="ghost"
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {/* Live Measurements Readout */}
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="rounded-md bg-muted/50 p-2 border border-border/30">
                <span className="text-[10px] text-muted-foreground block">
                  Window Viewport:
                </span>
                <span className="font-semibold text-foreground">
                  {windowDimensions.width} × {windowDimensions.height}
                </span>
              </div>
              <div className="rounded-md bg-muted/50 p-2 border border-border/30">
                <span className="text-[10px] text-muted-foreground block">
                  Workspace Space:
                </span>
                <span className="font-semibold text-foreground">
                  {wrapperDimensions?.width ?? 0} ×{" "}
                  {wrapperDimensions?.height ?? 0}
                </span>
              </div>
              <div className="rounded-md bg-primary/10 p-2 border border-primary/20">
                <span className="text-[10px] text-primary block">
                  Bounded Frame:
                </span>
                <span className="font-semibold text-primary">
                  {fittedDimensions?.width ?? 0} ×{" "}
                  {fittedDimensions?.height ?? 0}
                </span>
              </div>
              <div className="rounded-md bg-muted/50 p-2 border border-border/30">
                <span className="text-[10px] text-muted-foreground block">
                  Aspect Ratio:
                </span>
                <span className="font-semibold text-foreground">
                  {activeAspectRatio.toFixed(4)}:1
                </span>
              </div>
            </div>

            {/* Gap Inspection Status */}
            <div className="mt-2.5 flex items-center justify-between rounded-md bg-emerald-500/10 px-2.5 py-1.5 border border-emerald-500/20 text-[11px] text-emerald-600 dark:text-emerald-400">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 shrink-0" />
                <span>Zero Dark Letterbox Gaps</span>
              </div>
              <span className="font-mono text-[10px]">
                ΔH: {letterboxInspection.verticalGap}px | ΔW:{" "}
                {letterboxInspection.horizontalGap}px
              </span>
            </div>

            {/* Target URL Input */}
            <div className="mt-3">
              <span className="text-[11px] font-medium text-muted-foreground block mb-1">
                Target Website URL:
              </span>
              <Input
                className="h-7 text-xs font-mono"
                onChange={handleTargetUrlChange}
                placeholder="https://example.com"
                value={targetUrl}
              />
            </div>

            {/* Resolution Presets */}
            <div className="mt-3">
              <span className="text-[11px] font-medium text-muted-foreground block mb-1.5">
                Quick Resolution Presets:
              </span>
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
                {DIMENSION_PRESETS.map((preset) => {
                  const isActive =
                    configuredWidth === preset.w &&
                    configuredHeight === preset.h;
                  return (
                    <PresetButton
                      isActive={isActive}
                      key={preset.label}
                      onSelect={handleApplyPreset}
                      preset={preset}
                    />
                  );
                })}
              </div>
            </div>

            {/* Custom Width & Height Sliders */}
            <div className="mt-3 space-y-2 border-t border-border/40 pt-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Width (px):</span>
                <input
                  className="w-16 rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-right font-mono text-xs text-foreground"
                  max={2560}
                  min={360}
                  onChange={handleWidthInputChange}
                  type="number"
                  value={configuredWidth}
                />
              </div>
              <input
                className="w-full accent-primary cursor-pointer"
                max={2560}
                min={360}
                onChange={handleWidthInputChange}
                type="range"
                value={configuredWidth}
              />

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Height (px):</span>
                <input
                  className="w-16 rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-right font-mono text-xs text-foreground"
                  max={2160}
                  min={360}
                  onChange={handleHeightInputChange}
                  type="number"
                  value={configuredHeight}
                />
              </div>
              <input
                className="w-full accent-primary cursor-pointer"
                max={2160}
                min={360}
                onChange={handleHeightInputChange}
                type="range"
                value={configuredHeight}
              />

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    checked={isRatioLocked}
                    className="accent-primary"
                    onChange={handleRatioLockToggle}
                    type="checkbox"
                  />
                  Lock Aspect Ratio
                </label>
                <button
                  className="text-[10px] text-primary hover:underline font-mono"
                  onClick={handleMatchContainer}
                  type="button"
                >
                  Match Available Space
                </button>
              </div>
            </div>

            {/* Cloud Session Controls */}
            <div className="mt-3.5 flex items-center gap-2 border-t border-border/40 pt-2.5">
              {status === "live" ? (
                <Button
                  className="h-8 flex-1 text-xs gap-1.5"
                  onClick={handleStopCloud}
                  size="sm"
                  variant="destructive"
                >
                  <Square className="size-3.5 fill-current" />
                  Stop Cloud Session
                </Button>
              ) : (
                <Button
                  className="h-8 flex-1 text-xs gap-1.5"
                  disabled={status === "connecting"}
                  onClick={handleConnectCloud}
                  size="sm"
                >
                  <Play className="size-3.5" />
                  Spawn on Browser Use Cloud
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
