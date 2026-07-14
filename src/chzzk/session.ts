import axios from 'axios';
import { ChzzkSessionResponse } from '../types';

export async function createChzzkSession(accessToken: string): Promise<string> {
  const response = await axios.get<ChzzkSessionResponse>('https://openapi.chzzk.naver.com/open/v1/sessions/auth', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 10_000,
  });

  const sessionUrl = response.data?.content?.url;

  if (!sessionUrl) {
    throw new Error('치지직 세션 URL을 받지 못했습니다.');
  }

  return sessionUrl;
}
