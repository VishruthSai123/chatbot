import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getBrowserUseClient } from "@/lib/browser-use/client";
import { generateUUID } from "@/lib/utils";
import { ExecutionTracker } from "./execution-tracker";
import type { DownloadItem, DownloadStatus } from "./execution-types";
import { formatFileSize, getMimeType, sanitizeFileName } from "./mime-utils";

export const DOWNLOAD_STORAGE_ROOT = path.join(
  process.cwd(),
  "storage",
  "downloads"
);

/**
 * In-memory registry to ensure instant lookup and avoid duplicate downloads.
 */
const downloadCache = new Map<string, DownloadItem>();

/**
 * Ensures the target storage directory exists.
 */
export async function ensureStorageDirectory(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

/**
 * Returns the absolute path where a downloaded file is stored.
 */
export function getLocalFilePath(
  runId: string,
  downloadId: string,
  fileName: string
): string {
  const safeName = sanitizeFileName(fileName);
  return path.join(DOWNLOAD_STORAGE_ROOT, runId, downloadId, safeName);
}

/**
 * Returns the metadata file path for a download.
 */
export function getMetaFilePath(runId: string, downloadId: string): string {
  return path.join(DOWNLOAD_STORAGE_ROOT, runId, downloadId, "meta.json");
}

/**
 * Writes download metadata to disk for instant recovery even across server reboots.
 */
async function persistDownloadMetadata(item: DownloadItem): Promise<void> {
  try {
    const metaPath = getMetaFilePath(item.runId, item.downloadId);
    await ensureStorageDirectory(path.dirname(metaPath));
    await fs.promises.writeFile(
      metaPath,
      JSON.stringify(item, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.warn(
      `[DownloadManager] Could not write meta for ${item.downloadId}:`,
      err
    );
  }
}

/**
 * Safely streams a remote file from a presigned S3 URL into local disk.
 * Uses Node streams and pipeline to prevent buffering large files in memory.
 */
export async function streamRemoteFileToDisk(
  remoteUrl: string,
  destPath: string
): Promise<number> {
  await ensureStorageDirectory(path.dirname(destPath));

  const response = await fetch(remoteUrl);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to fetch remote download (${response.status} ${response.statusText})`
    );
  }

  const fileWriteStream = fs.createWriteStream(destPath);
  const webStream = Readable.fromWeb(response.body as any);

  await pipeline(webStream, fileWriteStream);

  const stats = await fs.promises.stat(destPath);
  return stats.size;
}

/**
 * Creates or registers a new download item.
 */
export async function registerDownloadItem(params: {
  runId: string;
  chatId: string;
  fileName: string;
  fileSize?: number;
  remoteUrl?: string;
  status?: DownloadStatus;
}): Promise<DownloadItem> {
  const downloadId = `dl_${generateUUID()}`;
  const now = new Date().toISOString();
  const safeName = sanitizeFileName(params.fileName);
  const mimeType = getMimeType(safeName);
  const localPath = getLocalFilePath(params.runId, downloadId, safeName);

  const item: DownloadItem = {
    createdAt: now,
    downloadId,
    fileName: safeName,
    fileSize: params.fileSize,
    localPath,
    mimeType,
    remoteUrl: params.remoteUrl,
    runId: params.runId,
    status: params.status || "started",
    url: `/api/qa/runs/${params.runId}/downloads/${downloadId}`,
  };

  downloadCache.set(downloadId, item);
  ExecutionTracker.addDownload(params.chatId, item);
  await persistDownloadMetadata(item);

  return item;
}

/**
 * Updates an existing download item's status, size, or path.
 */
export async function updateDownloadItem(
  chatId: string,
  downloadId: string,
  updates: Partial<DownloadItem>
): Promise<DownloadItem | null> {
  const existing = downloadCache.get(downloadId);
  const updatedRun = ExecutionTracker.updateDownload(
    chatId,
    downloadId,
    updates
  );

  const updatedItem: DownloadItem = {
    ...(existing || {
      createdAt: new Date().toISOString(),
      downloadId,
      fileName: "download.bin",
      mimeType: "application/octet-stream",
      runId: updatedRun?.runId || "unknown",
      status: "ready",
    }),
    ...updates,
  };

  downloadCache.set(downloadId, updatedItem);
  await persistDownloadMetadata(updatedItem);

  return updatedItem;
}

/**
 * Fetches a download item by runId and downloadId.
 * Checks in-memory cache, ExecutionTracker, DB snapshot, and disk meta.json.
 */
export async function getDownloadItem(
  runId: string,
  downloadId: string
): Promise<DownloadItem | null> {
  // 1. In-memory cache
  const cached = downloadCache.get(downloadId);
  if (cached) {
    return cached;
  }

  // 2. ExecutionTracker run
  const run = ExecutionTracker.getRunById(runId);
  if (run?.downloads) {
    const found = run.downloads.find((d) => d.downloadId === downloadId);
    if (found) {
      downloadCache.set(downloadId, found);
      return found;
    }
  }

  // 3. Disk metadata
  try {
    const metaPath = getMetaFilePath(runId, downloadId);
    if (fs.existsSync(metaPath)) {
      const content = await fs.promises.readFile(metaPath, "utf-8");
      const parsed = JSON.parse(content) as DownloadItem;
      downloadCache.set(downloadId, parsed);
      return parsed;
    }
  } catch (err) {
    console.warn(
      `[DownloadManager] Could not read disk meta for ${downloadId}:`,
      err
    );
  }

  return null;
}

/**
 * Synchronizes real downloads from Browser Use Cloud for the active browser session.
 * Detects newly downloaded files in remote Chrome, captures them, and updates execution state.
 */
export async function syncBrowserDownloads({
  browserSessionId,
  chatId,
  runId,
  onDownload,
}: {
  browserSessionId: string;
  chatId: string;
  runId: string;
  onDownload?: (item: DownloadItem) => void | Promise<void>;
}): Promise<DownloadItem[]> {
  if (!browserSessionId || !runId) {
    return [];
  }

  let client: ReturnType<typeof getBrowserUseClient>;
  try {
    client = getBrowserUseClient();
  } catch (err) {
    console.warn(
      "[DownloadManager] Browser Use client unavailable for sync:",
      err
    );
    return [];
  }

  try {
    // Native Browser Use API for downloads
    const response = await client.browsers.downloads(browserSessionId, {
      includeUrls: true,
    });

    const files = response?.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      return [];
    }

    const currentRun =
      ExecutionTracker.getActiveRun(chatId) ||
      ExecutionTracker.getRunById(runId);
    const existingDownloads = currentRun?.downloads || [];
    const discoveredItems: DownloadItem[] = [];

    for (const file of files) {
      const fileName = file.path ? path.basename(file.path) : "";
      if (!fileName) {
        continue;
      }

      // Check if this file was already captured for this run
      const alreadyCaptured = existingDownloads.some(
        (d) =>
          d.fileName === fileName &&
          (d.status === "ready" || d.status === "downloading")
      );

      if (alreadyCaptured) {
        continue;
      }

      console.log(
        `[DownloadManager] Detected real download in session ${browserSessionId}: "${fileName}" (${formatFileSize(file.size)})`
      );

      // Register as downloading
      // biome-ignore lint/performance/noAwaitInLoops: sequential registration of detected downloads
      const item = await registerDownloadItem({
        chatId,
        fileName,
        fileSize: file.size,
        remoteUrl: file.url || undefined,
        runId,
        status: file.url ? "downloading" : "ready",
      });

      discoveredItems.push(item);
      if (onDownload) {
        try {
          await onDownload(item);
        } catch (callbackErr) {
          console.error(
            "[DownloadManager] onDownload callback error:",
            callbackErr
          );
        }
      }

      // If remote presigned URL exists, safely stream it to local storage in background
      const remoteUrl = file.url;
      if (remoteUrl) {
        const destPath = getLocalFilePath(runId, item.downloadId, fileName);
        (async () => {
          try {
            const actualSize = await streamRemoteFileToDisk(
              remoteUrl,
              destPath
            );
            const readyItem = await updateDownloadItem(
              chatId,
              item.downloadId,
              {
                fileSize: actualSize || file.size,
                localPath: destPath,
                status: "ready",
              }
            );
            console.log(
              `[DownloadManager] Download ready: "${fileName}" -> ${destPath} (${formatFileSize(actualSize)})`
            );
            if (readyItem && onDownload) {
              await onDownload(readyItem);
            }
          } catch (err: any) {
            console.error(
              `[DownloadManager] Failed to stream remote file "${fileName}":`,
              err
            );
            const failedItem = await updateDownloadItem(
              chatId,
              item.downloadId,
              {
                error: err?.message || "Failed to transfer file",
                status: "failed",
              }
            );
            if (failedItem && onDownload) {
              await onDownload(failedItem);
            }
          }
        })();
      }
    }

    return discoveredItems;
  } catch (err: any) {
    // Non-fatal: detection failure must not fail the QA run
    console.warn(
      `[DownloadManager] Error checking downloads for session ${browserSessionId}:`,
      err?.message || err
    );
    return [];
  }
}
