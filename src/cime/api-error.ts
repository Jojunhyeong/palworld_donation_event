import axios from 'axios';

export function getSafeErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown; error?: unknown } | undefined;
    const message = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : '';
    return message ? `${fallback}: ${message}` : fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
