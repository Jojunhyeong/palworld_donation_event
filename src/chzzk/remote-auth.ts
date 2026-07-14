import crypto from 'crypto';
import http from 'http';
import axios from 'axios';
import { ChzzkAuthTokens } from '../types';

interface StartResponse {
  authorizationUrl?: string;
}

interface ClaimResponse extends ChzzkAuthTokens {
  tokenType?: string;
  expiresIn?: string | number;
  scope?: string;
}

type AuthorizationUrlHandler = (url: string) => void | Promise<void>;

const LOCAL_CALLBACK = new URL('http://localhost:3000/auth/callback');

export async function authorizeWithRemoteService(
  authServiceUrl: string,
  onAuthorizationUrl: AuthorizationUrlHandler,
): Promise<ChzzkAuthTokens> {
  const serviceUrl = authServiceUrl.replace(/\/$/, '');
  if (!serviceUrl.startsWith('https://') || serviceUrl.includes('YOUR_SUBDOMAIN')) {
    throw new Error('치지직 인증 서비스가 아직 설정되지 않았습니다.');
  }

  const localState = crypto.randomUUID();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const verifierHash = crypto.createHash('sha256').update(verifier).digest('base64url');

  return new Promise<ChzzkAuthTokens>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, tokens?: ChzzkAuthTokens) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      if (error) reject(error);
      else if (tokens) resolve(tokens);
    };

    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', LOCAL_CALLBACK.origin);
      if (requestUrl.pathname !== LOCAL_CALLBACK.pathname) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
        return;
      }

      const ticket = requestUrl.searchParams.get('ticket');
      const state = requestUrl.searchParams.get('state');
      if (!ticket || state !== localState) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('인증 요청을 확인할 수 없습니다.');
        return;
      }

      try {
        const claim = await axios.post<ClaimResponse>(
          `${serviceUrl}/auth/claim`,
          { ticket, verifier },
          { timeout: 10_000, headers: { 'Content-Type': 'application/json' } },
        );
        if (!claim.data?.accessToken) throw new Error('치지직 인증 토큰을 받지 못했습니다.');

        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('치지직 연결이 완료되었습니다. 이 창을 닫아도 됩니다.');
        finish(undefined, { accessToken: claim.data.accessToken, refreshToken: claim.data.refreshToken });
      } catch (error) {
        response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('인증 결과를 앱으로 전달하지 못했습니다.');
        finish(error);
      }
    });

    const timeout = setTimeout(() => finish(new Error('치지직 인증 시간이 초과되었습니다.')), 5 * 60 * 1000);
    server.once('error', (error) => finish(error));
    server.listen(Number(LOCAL_CALLBACK.port), LOCAL_CALLBACK.hostname, async () => {
      try {
        const start = await axios.post<StartResponse>(
          `${serviceUrl}/auth/start`,
          { localState, verifierHash },
          { timeout: 10_000, headers: { 'Content-Type': 'application/json' } },
        );
        if (!start.data?.authorizationUrl) throw new Error('치지직 인증 URL을 받지 못했습니다.');
        await onAuthorizationUrl(start.data.authorizationUrl);
      } catch (error) {
        finish(error);
      }
    });
  });
}
