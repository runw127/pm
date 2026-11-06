export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const errorFrom = async (response: Response, fallback: string) => {
  const error = await response.json().catch(() => null);
  return new ApiError(
    typeof error?.detail === "string" ? error.detail : `${fallback} (${response.status})`,
    response.status
  );
};

export const request = async <T>(path: string, method = "GET", body?: object): Promise<T> => {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw await errorFrom(response, "Request failed");
  return (response.status === 204 ? undefined : await response.json()) as T;
};

export const isExpired = (cause: unknown) => cause instanceof ApiError && cause.status === 401;

export const messageOf = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;
