import axios from 'axios';
import { CimeSessionResponse } from '../types';

const CIME_API_BASE = 'https://ci.me/api/openapi';

export async function createCimeSession(accessToken: string): Promise<string> {
  const response = await axios.get<CimeSessionResponse>(`${CIME_API_BASE}/open/v1/sessions/auth`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10_000,
  });

  const sessionUrl = response.data?.content?.url;
  if (!sessionUrl) throw new Error('씨미 세션 URL을 받지 못했습니다.');
  return sessionUrl;
}
