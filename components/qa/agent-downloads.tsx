"use client";

import {
  ArrowDownToLine,
  CheckCircle2,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Loader2,
  XCircle,
} from "lucide-react";
import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface DownloadItemData {
  downloadId: string;
  error?: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  runId: string;
  status: "started" | "downloading" | "ready" | "failed";
}

interface AgentDownloadsProps {
  className?: string;
  downloads: DownloadItemData[];
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes <= 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIcon(mimeType?: string, fileName?: string) {
  const mime = (mimeType || "").toLowerCase();
  const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";

  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)
  ) {
    return FileImage;
  }
  if (
    mime.startsWith("video/") ||
    ["mp4", "webm", "mov", "avi"].includes(ext)
  ) {
    return FileVideo;
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return FileText;
  }
  if (
    mime.includes("spreadsheet") ||
    mime === "text/csv" ||
    ["csv", "xlsx", "xls"].includes(ext)
  ) {
    return FileSpreadsheet;
  }
  if (
    mime.includes("zip") ||
    mime.includes("compressed") ||
    mime.includes("archive") ||
    ["zip", "tar", "gz", "rar", "7z"].includes(ext)
  ) {
    return FileArchive;
  }
  return File;
}

const DownloadRow = memo(function DownloadRowItem({
  item,
}: {
  item: DownloadItemData;
}) {
  const IconComponent = getFileIcon(item.mimeType, item.fileName);
  const sizeLabel = formatFileSize(item.fileSize);
  const isReady = item.status === "ready";
  const isLoading = item.status === "started" || item.status === "downloading";
  const isFailed = item.status === "failed";

  const handleDownload = useCallback(() => {
    if (!isReady) {
      return;
    }
    const url = `/api/qa/runs/${item.runId}/downloads/${item.downloadId}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = item.fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [isReady, item.runId, item.downloadId, item.fileName]);

  return (
    <div className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-card/50 px-3 py-2 transition-colors hover:bg-card/80">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          isFailed
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary"
        )}
      >
        <IconComponent className="size-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium leading-snug text-foreground">
          {item.fileName}
        </span>
        <div className="flex items-center gap-1.5">
          {sizeLabel ? (
            <span className="text-[11px] text-muted-foreground">
              {sizeLabel}
            </span>
          ) : null}
          {isLoading ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Downloading…
            </span>
          ) : null}
          {isFailed ? (
            <span className="flex items-center gap-1 text-[11px] text-destructive">
              <XCircle className="size-3" />
              {item.error || "Failed"}
            </span>
          ) : null}
          {isReady ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3" />
              Ready
            </span>
          ) : null}
        </div>
      </div>

      <button
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
          isReady
            ? "cursor-pointer text-primary hover:bg-primary/10"
            : "cursor-not-allowed text-muted-foreground/40"
        )}
        disabled={!isReady}
        onClick={handleDownload}
        title={isReady ? `Download ${item.fileName}` : "Not ready yet"}
        type="button"
      >
        <ArrowDownToLine className="size-4" />
      </button>
    </div>
  );
});

export const AgentDownloads = memo(function AgentDownloadsContainer({
  className,
  downloads,
}: AgentDownloadsProps) {
  if (!downloads || downloads.length === 0) {
    return null;
  }

  return (
    <div className={cn("mt-2 space-y-1.5", className)}>
      <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-muted-foreground/70">
        <ArrowDownToLine className="size-3.5" />
        Downloads ({downloads.length})
      </div>
      <div className="space-y-1">
        {downloads.map((dl) => (
          <DownloadRow item={dl} key={dl.downloadId} />
        ))}
      </div>
    </div>
  );
});

AgentDownloads.displayName = "AgentDownloads";
