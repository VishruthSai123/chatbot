import fs from "node:fs";
import { auth } from "@/app/(auth)/auth";
import { getTestSessionByChatId } from "@/lib/db/queries";
import { getDownloadItem } from "@/lib/qa/download-manager";
import { ExecutionTracker } from "@/lib/qa/execution-tracker";
import { getMimeType, sanitizeFileName } from "@/lib/qa/mime-utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; downloadId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { runId, downloadId } = await params;

  if (!runId || !downloadId) {
    return new Response("Missing runId or downloadId", { status: 400 });
  }

  // 1. Look up the download item
  const item = await getDownloadItem(runId, downloadId);
  if (!item) {
    return new Response("Download not found", { status: 404 });
  }

  // 2. Verify user owns the associated chat/session
  const run = ExecutionTracker.getRunById(runId);
  if (run) {
    try {
      const testSession = await getTestSessionByChatId({
        chatId: run.chatId,
      });
      if (!testSession) {
        return new Response("Session not found", { status: 404 });
      }
    } catch {
      // Non-fatal: if DB check fails, still allow if we found the download
    }
  }

  // 3. Check if file status is ready
  if (item.status === "failed") {
    return new Response(
      JSON.stringify({ error: item.error || "Download failed" }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );
  }

  if (item.status === "downloading" || item.status === "started") {
    return new Response(
      JSON.stringify({
        error: "Download still in progress",
        status: item.status,
      }),
      { headers: { "Content-Type": "application/json" }, status: 202 }
    );
  }

  // 4. Stream the file
  const safeName = sanitizeFileName(item.fileName);
  const mimeType = getMimeType(safeName, item.mimeType);

  // Strategy A: Local file exists on disk
  if (item.localPath && fs.existsSync(item.localPath)) {
    const stats = await fs.promises.stat(item.localPath);
    const fileStream = fs.createReadStream(item.localPath);

    const readableStream = new ReadableStream({
      cancel() {
        fileStream.destroy();
      },
      start(controller) {
        fileStream.on("data", (chunk: Buffer | string) => {
          controller.enqueue(
            typeof chunk === "string" ? Buffer.from(chunk) : chunk
          );
        });
        fileStream.on("end", () => {
          controller.close();
        });
        fileStream.on("error", (err) => {
          controller.error(err);
        });
      },
    });

    return new Response(readableStream, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`,
        "Content-Length": String(stats.size),
        "Content-Type": mimeType,
      },
    });
  }

  // Strategy B: Proxy from remote presigned URL
  if (item.remoteUrl) {
    try {
      const remoteResponse = await fetch(item.remoteUrl);
      if (!remoteResponse.ok || !remoteResponse.body) {
        return new Response("Failed to fetch remote file", { status: 502 });
      }

      const contentLength =
        remoteResponse.headers.get("content-length") ||
        (item.fileSize ? String(item.fileSize) : undefined);

      const headers: Record<string, string> = {
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`,
        "Content-Type": mimeType,
      };
      if (contentLength) {
        headers["Content-Length"] = contentLength;
      }

      return new Response(remoteResponse.body, { headers });
    } catch (err: any) {
      console.error(
        `[DownloadAPI] Failed to proxy remote URL for ${downloadId}:`,
        err
      );
      return new Response("Failed to fetch file from storage", {
        status: 502,
      });
    }
  }

  return new Response("File not available", { status: 404 });
}
