export const ORIGINAL_SIGNED_URL_TTL_SECONDS = 5 * 60;

export function sanitizeOriginalFilename(value: string): string {
  const leaf = value.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = leaf
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || "archivo-original";
}

export function originalFilename(metadata: unknown, fallbackPath: string | null): string {
  const meta = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  if (typeof meta.original_filename === "string" && meta.original_filename.trim()) {
    return sanitizeOriginalFilename(meta.original_filename);
  }
  return sanitizeOriginalFilename(fallbackPath?.split("/").pop() ?? "archivo-original");
}
