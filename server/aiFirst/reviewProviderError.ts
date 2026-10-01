import Anthropic from "@anthropic-ai/sdk";

/** Retain a bounded diagnostic, never SDK headers, request bodies, or credentials. */
export function reviewProviderError(error: unknown, secrets: (string | undefined)[]) {
  if (!(error instanceof Anthropic.APIError)) return { name: "request-failed" };
  const body = error.error as { error?: { message?: unknown }; message?: unknown } | undefined;
  const raw = body?.error?.message ?? body?.message;
  let message = typeof raw === "string" ? raw : null;
  if (message !== null) {
    for (const secret of secrets) if (secret) message = message.split(secret).join("[redacted]");
    message = message.replace(/https?:\/\/[^\s"<>]+/gi, "[redacted-url]")
      .replace(/(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]+)/gi, "[redacted]")
      .replace(/[A-Za-z0-9+/=_-]{128,}/g, "[redacted-long-value]")
      .replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 2000);
  }
  const safeId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
  return { status: error.status ?? null, name: safeId(error.name), type: safeId(error.type),
    requestId: safeId(error.requestID), message };
}
