/**
 * Fetches a file from the API and hands it to the browser as a download.
 *
 * A bare `<a download>` gives no feedback while the server is still producing
 * the file, and a failure surfaces only as the browser's own "Site wasn't
 * available". Fetching first lets the caller show progress and report the
 * API's real error message.
 */
import { ApiError, type ApiErrorBody } from "@/lib/api-client";

function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // Fall through to the plain filename.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : fallback;
}

export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include" });
  } catch (cause) {
    throw new ApiError(0, "network_error", "Could not reach the WikiHub API.", {
      cause: String(cause),
    });
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const envelope = payload?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? "http_error",
      envelope?.message ?? `Request failed with status ${response.status}.`,
      envelope?.details ?? {},
      envelope?.request_id ?? response.headers.get("X-Request-ID"),
    );
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filenameFrom(response.headers.get("content-disposition"), fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
