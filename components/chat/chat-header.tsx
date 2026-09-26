"use client";

import { Globe, PanelLeftIcon } from "lucide-react";
import Link from "next/link";
import { memo, useCallback } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useArtifact } from "@/hooks/use-artifact";
import { cn, fetcher } from "@/lib/utils";
import { VercelIcon } from "./icons";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";

function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
}) {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const { artifact, setArtifact, metadata } = useArtifact();

  // Check if a browser session exists for this chat in the database
  const { data: sessionData } = useSWR<{
    session: {
      id: string;
      browserSessionId: string;
      liveUrl: string | null;
      targetUrl: string;
      status: string;
    } | null;
  }>(chatId ? `/api/qa/session?chatId=${chatId}` : null, fetcher, {
    revalidateOnFocus: false,
  });

  const hasBrowserSession = Boolean(
    sessionData?.session?.liveUrl ||
      metadata?.liveUrl ||
      (artifact.kind === "browser" && artifact.isVisible)
  );

  const isBrowserOpen = Boolean(
    artifact.isVisible && artifact.kind === "browser"
  );
  const rawStatus = metadata?.status ?? sessionData?.session?.status;
  const isWorking = rawStatus === "working";
  const isLive = rawStatus === "live" || rawStatus === "active";

  const handleToggleBrowser = useCallback(() => {
    setArtifact((prev) => {
      const willBeVisible = !(prev.isVisible && prev.kind === "browser");
      return {
        ...prev,
        isVisible: willBeVisible,
        kind: "browser",
        title: prev.title || sessionData?.session?.targetUrl || "Live Browser",
      };
    });
  }, [setArtifact, sessionData]);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 bg-sidebar px-3">
      {/* Show sidebar toggle on mobile OR on desktop when sidebar is collapsed */}
      {isMobile || state === "collapsed" ? (
        <Button
          className="size-8"
          onClick={toggleSidebar}
          size="icon-sm"
          variant="outline"
        >
          <PanelLeftIcon className="size-4" />
        </Button>
      ) : null}

      <Link
        className="flex size-8 items-center justify-center rounded-lg md:hidden"
        href="https://vercel.com/templates/next.js/chatbot"
        rel="noopener noreferrer"
        target="_blank"
      >
        <VercelIcon size={14} />
      </Link>

      {isReadonly ? null : (
        <VisibilitySelector
          chatId={chatId}
          selectedVisibilityType={selectedVisibilityType}
        />
      )}

      {/* Browser Toggle Button (Top-Right) */}
      {hasBrowserSession ? (
        <Button
          className={cn(
            "h-8 gap-2 px-2.5 text-xs font-medium md:ml-auto transition-all",
            isBrowserOpen
              ? "bg-muted text-foreground border-border shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={handleToggleBrowser}
          size="sm"
          variant="outline"
        >
          <Globe className="size-3.5" />
          <span>Browser</span>
          {isWorking ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-500">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
              Working
            </span>
          ) : isLive ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
              Ready
            </span>
          )}
        </Button>
      ) : null}
    </header>
  );
}

export const ChatHeader = memo(
  PureChatHeader,
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly
);
