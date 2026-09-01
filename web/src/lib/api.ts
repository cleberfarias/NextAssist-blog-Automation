export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function apiGet<T>(
  path: string,
  workspace?: string,
  signal?: AbortSignal,
  fallbackMessage?: string,
): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (workspace) url.searchParams.set("workspace", workspace);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new ApiError(fallbackMessage ?? `API ${response.status}: ${path}`, response.status, undefined);
  }
  return (await response.json()) as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  fallbackMessage?: string,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string })?.error ?? fallbackMessage ?? `API ${response.status}: ${path}`;
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}
