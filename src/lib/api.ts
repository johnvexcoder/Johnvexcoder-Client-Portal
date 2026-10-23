export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase(),
    retryable =
      method === "GET" || (method === "PUT" && /\/sections\//.test(path));
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(path, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      const value = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok)
        throw Object.assign(
          new Error(
            value.error ?? value.message ?? "Please retry this action.",
          ),
          { status: response.status },
        );
      return value as T;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (
        !retryable ||
        attempt >= 2 ||
        options.signal?.aborted ||
        (status !== undefined && ![502, 503, 504].includes(status))
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
}
