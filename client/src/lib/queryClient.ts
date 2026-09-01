import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = "__PORT_5050__".startsWith("__") ? "" : "__PORT_5050__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  // Do not retry deterministic client/auth/not-found failures. Network errors
  // and 5xx responses are safe to retry because queryFns are GET-only reads.
  return !/^(4\d\d):/.test(message);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

// Like apiRequest, but parses the JSON body on both success and failure so
// error payloads (e.g. { error, authUrl }) can be surfaced to the caller
// instead of being flattened into a plain Error message string.
export async function apiRequestJson<T = any>(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(parsed?.error || `Request failed (${res.status})`) as Error & { authUrl?: string };
    err.authUrl = parsed?.authUrl;
    throw err;
  }
  return parsed as T;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: Infinity,
      retry: shouldRetryQuery,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000),
    },
    mutations: {
      // Mutations remain non-retrying by default. Some POSTs spend AI credits
      // or trigger delivery, so recovery must be explicitly idempotent there.
      retry: false,
    },
  },
});
