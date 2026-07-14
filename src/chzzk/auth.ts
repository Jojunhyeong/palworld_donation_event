import crypto from 'crypto';
import http from 'http';
import axios from 'axios';
import { ChzzkAuthTokens, ChzzkTokenResponse } from '../types';

interface AuthorizationRequest {
  url: string;
  state: string;
}

export interface ChzzkAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type AuthorizationUrlHandler = (url: string) => void | Promise<void>;

function getAuthConfig(config?: ChzzkAuthConfig): ChzzkAuthConfig {
  return config ?? {
    clientId: process.env.CHZZK_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.CHZZK_CLIENT_SECRET?.trim() ?? '',
    redirectUri: process.env.CHZZK_REDIRECT_URI?.trim() || 'http://localhost:3000/auth/callback',
  };
}

export function buildAuthorizationRequest(config?: ChzzkAuthConfig): AuthorizationRequest {
  const { clientId, redirectUri } = getAuthConfig(config);

  if (!clientId) {
    throw new Error('CHZZK_CLIENT_ID가 설정되지 않았습니다.');
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    clientId,
    redirectUri,
    state,
  });

  return {
    url: `https://chzzk.naver.com/account-interlock?${params.toString()}`,
    state,
  };
}

export async function authorizeWithLocalCallback(
  config?: ChzzkAuthConfig,
  onAuthorizationUrl?: AuthorizationUrlHandler,
): Promise<ChzzkAuthTokens> {
  const authConfig = getAuthConfig(config);
  const { redirectUri } = authConfig;
  const redirectUrl = new URL(redirectUri);

  if (redirectUrl.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(redirectUrl.hostname)) {
    throw new Error('현재 프로그램은 localhost HTTP 리디렉션 URL만 지원합니다.');
  }

  const port = Number(redirectUrl.port || 80);
  const authorization = buildAuthorizationRequest(authConfig);

  return new Promise<ChzzkAuthTokens>((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', redirectUrl.origin);

      if (requestUrl.pathname !== redirectUrl.pathname) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
        return;
      }

      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');

      if (!code || !state || state !== authorization.state) {
        response.writeHead(400, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end('인증 요청을 확인할 수 없습니다. 터미널에서 다시 시작해 주세요.');
        return;
      }

      try {
        const tokens = await exchangeAuthorizationCode(authConfig, code, state);
        response.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end('치지직 인증이 완료되었습니다. 이 창을 닫아도 됩니다.');
        server.close();
        resolve(tokens);
      } catch (error) {
        response.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end('토큰 발급에 실패했습니다. 터미널을 확인해 주세요.');
        server.close();
        reject(error);
      }
    });

    server.once('error', reject);
    server.listen(port, redirectUrl.hostname, async () => {
      if (onAuthorizationUrl) {
        await onAuthorizationUrl(authorization.url);
      } else {
        console.log('치지직 인증을 위해 아래 URL을 브라우저에서 열어 주세요.');
        console.log(authorization.url);
      }
    });
  });
}

async function exchangeAuthorizationCode(
  config: ChzzkAuthConfig,
  code: string,
  state: string,
): Promise<ChzzkAuthTokens> {
  const { clientId, clientSecret } = config;

  if (!clientId || !clientSecret) {
    throw new Error('치지직 Client ID 또는 Client Secret이 설정되지 않았습니다.');
  }

  const response = await axios.post<ChzzkTokenResponse>(
    'https://openapi.chzzk.naver.com/auth/v1/token',
    {
      grantType: 'authorization_code',
      clientId,
      clientSecret,
      code,
      state,
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    },
  );

  const tokens = response.data?.content;
  if (!tokens?.accessToken) {
    throw new Error('치지직 Access Token을 받지 못했습니다.');
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}
