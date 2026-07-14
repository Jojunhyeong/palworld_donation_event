import axios from 'axios';

interface ApiErrorBody {
  code?: string | number;
  message?: string;
}

export function getSafeErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const body = error.response?.data as ApiErrorBody | undefined;
    const apiCode = body?.message ?? body?.code;
    const details = [status, apiCode].filter((value) => value !== undefined).join(' / ');

    return details ? `${fallback} (${details})` : fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}
