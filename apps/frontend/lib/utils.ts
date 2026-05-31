import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for insecure contexts.
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) {
      throw new Error("Clipboard copy command was rejected");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
