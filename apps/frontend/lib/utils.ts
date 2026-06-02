import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a byte count into a human-readable string (B / KB / MB / GB / TB),
 * using binary (1024) units. Returns "0 B" for zero/negative input.
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** i
  // No decimals for bytes (whole numbers); configured precision otherwise.
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

/**
 * Copy text to the clipboard with a fallback for insecure contexts.
 *
 * `navigator.clipboard` is only defined in a secure context (https, or
 * http://localhost). For the common self-hosted case — http:// on a LAN host —
 * it is undefined, so calling navigator.clipboard.writeText threw synchronously
 * and the copy buttons appeared inactive. This tries the async Clipboard API
 * first, then falls back to a hidden textarea + document.execCommand("copy").
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard?.writeText &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(text)
    return
  }

  // Fallback for insecure contexts.
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()
  try {
    const ok = document.execCommand("copy")
    if (!ok) {
      throw new Error("Clipboard copy command was rejected")
    }
  } finally {
    document.body.removeChild(textarea)
  }
}
