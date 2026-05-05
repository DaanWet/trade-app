export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
