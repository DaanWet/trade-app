export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

/**
 * errorMessage plus the network error code undici hides in `cause`: a failed `fetch` only says
 * "fetch failed", which names neither a timeout nor a header overflow nor a reset. The code
 * only, never `cause.message`: that can carry the URL, and logs must not.
 */
export function fetchErrorMessage(err: unknown): string {
  const code = err instanceof Error ? (err.cause as { code?: unknown } | undefined)?.code : undefined;
  return typeof code === 'string' ? `${errorMessage(err)} (${code})` : errorMessage(err);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
