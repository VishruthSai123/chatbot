import path from "node:path";

/**
 * Comprehensive MIME type dictionary covering all common and binary formats.
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  "7z": "application/x-7z-compressed",
  apk: "application/vnd.android.package-archive",
  avi: "video/x-msvideo",
  avif: "image/avif",
  bin: "application/octet-stream",
  bmp: "image/bmp",
  bz2: "application/x-bzip2",
  css: "text/css; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  deb: "application/vnd.debian.binary-package",
  dmg: "application/x-apple-diskimage",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

  // Installers & Executables
  exe: "application/vnd.microsoft.portable-executable",
  flac: "audio/flac",
  gif: "image/gif",
  gz: "application/gzip",
  htm: "text/html; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  iso: "application/x-iso9660-image",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript",

  // Code & Structured Data
  json: "application/json; charset=utf-8",
  m4a: "audio/mp4",
  md: "text/markdown; charset=utf-8",
  mjs: "application/javascript",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",

  // Audio & Video
  mp4: "video/mp4",
  msi: "application/x-msi",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  ogg: "audio/ogg",
  // Documents
  pdf: "application/pdf",
  pkg: "application/octet-stream",

  // Images
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  py: "text/x-python",
  rar: "application/vnd.rar",
  rpm: "application/x-rpm",
  rtf: "application/rtf",
  sql: "application/sql",
  svg: "image/svg+xml",
  tar: "application/x-tar",
  tgz: "application/gzip",
  tif: "image/tiff",
  tiff: "image/tiff",
  ts: "application/typescript",
  tsv: "text/tab-separated-values; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml; charset=utf-8",
  xz: "application/x-xz",
  yaml: "application/yaml",
  yml: "application/yaml",

  // Archives & Compressed
  zip: "application/zip",
};

/**
 * Resolves the MIME type for a given filename, falling back to application/octet-stream.
 */
export function getMimeType(
  fileName: string,
  overrideContentType?: string | null
): string {
  if (
    overrideContentType &&
    overrideContentType !== "application/octet-stream"
  ) {
    return overrideContentType;
  }
  const ext = path.extname(fileName).toLowerCase().replace(/^\./, "");
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

/**
 * Sanitizes a filename to prevent path traversal or illegal characters.
 */
export function sanitizeFileName(rawName: string): string {
  const base = path.basename(rawName.trim());
  const sanitized = base.replace(/[/\\:*?"<>|]/g, "_").trim();
  return sanitized || "download.bin";
}

/**
 * Formats a file size in bytes to a human-readable string (e.g. "1.2 MB").
 */
export function formatFileSize(bytes?: number): string {
  if (
    bytes === undefined ||
    bytes === null ||
    Number.isNaN(bytes) ||
    bytes < 0
  ) {
    return "Unknown size";
  }
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unit = units[Math.min(i, units.length - 1)];
  const value = bytes / 1024 ** i;
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}
