interface Env {
  CIME_CLIENT_ID: string;
  CIME_CLIENT_SECRET: string;
  CIME_REDIRECT_URI: string;
  OAUTH_SESSIONS: KVNamespace;
}

interface PendingSession {
  localState: string;
  verifierHash: string;
}

interface TicketSession extends PendingSession {
  encryptedTokens: string;
  iv: string;
}

interface CimeTokenResponse {
  content?: {
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn?: string | number;
    scope?: string;
  };
  code?: string | number;
  message?: string;
}

const LOCAL_CALLBACK = 'http://localhost:3000/auth/callback';
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/auth/start') {
      return startAuthorization(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      return finishAuthorization(url, env);
    }

    if (request.method === 'POST' && url.pathname === '/auth/claim') {
      return claimTokens(request, env);
    }

    return json({ error: 'NOT_FOUND' }, 404);
  },
} satisfies ExportedHandler<Env>;

async function startAuthorization(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ localState?: string; verifierHash?: string }>(request);
  const localState = body?.localState?.trim();
  const verifierHash = body?.verifierHash?.trim();

  if (!localState || !verifierHash || !isBase64Url(verifierHash)) {
    return json({ error: 'INVALID_REQUEST' }, 400);
  }

  const state = crypto.randomUUID();
  const pending: PendingSession = { localState, verifierHash };
  await env.OAUTH_SESSIONS.put(`pending:${state}`, JSON.stringify(pending), { expirationTtl: 300 });

  const params = new URLSearchParams({
    clientId: env.CIME_CLIENT_ID,
    redirectUri: env.CIME_REDIRECT_URI,
    state,
  });

  return json({
    authorizationUrl: `https://ci.me/auth/openapi/account-interlock?${params.toString()}`,
  });
}

async function finishAuthorization(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return text('인증 요청이 올바르지 않습니다.', 400);

  const pendingKey = `pending:${state}`;
  const pending = await env.OAUTH_SESSIONS.get<PendingSession>(pendingKey, 'json');
  if (!pending) return text('인증 요청이 만료되었습니다. 앱에서 다시 시작해 주세요.', 400);

  const tokenResponse = await fetch('https://ci.me/api/openapi/auth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'authorization_code',
      clientId: env.CIME_CLIENT_ID,
      clientSecret: env.CIME_CLIENT_SECRET,
      code,
    }),
  });
  const tokenBody = await tokenResponse.json<CimeTokenResponse>();
  if (!tokenResponse.ok || !tokenBody.content?.accessToken) {
    return text(`씨미 토큰 발급에 실패했습니다. (${tokenResponse.status})`, 502);
  }

  const encrypted = await encryptTokens(tokenBody.content, pending.verifierHash);
  const ticket = randomBase64Url(32);
  const ticketSession: TicketSession = { ...pending, ...encrypted };
  await env.OAUTH_SESSIONS.put(`ticket:${ticket}`, JSON.stringify(ticketSession), { expirationTtl: 120 });
  await env.OAUTH_SESSIONS.delete(pendingKey);

  const callback = new URL(LOCAL_CALLBACK);
  callback.searchParams.set('ticket', ticket);
  callback.searchParams.set('state', pending.localState);
  return Response.redirect(callback.toString(), 302);
}

async function claimTokens(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ ticket?: string; verifier?: string }>(request);
  const ticket = body?.ticket?.trim();
  const verifier = body?.verifier?.trim();
  if (!ticket || !verifier) return json({ error: 'INVALID_REQUEST' }, 400);

  const ticketKey = `ticket:${ticket}`;
  const session = await env.OAUTH_SESSIONS.get<TicketSession>(ticketKey, 'json');
  if (!session) return json({ error: 'TICKET_EXPIRED' }, 410);

  try {
    const verifierHash = await sha256Base64Url(verifier);
    if (verifierHash !== session.verifierHash) return json({ error: 'INVALID_VERIFIER' }, 401);
    const tokens = await decryptTokens(session, verifierHash);
    await env.OAUTH_SESSIONS.delete(ticketKey);
    return json(tokens);
  } catch {
    return json({ error: 'INVALID_TICKET' }, 401);
  }
}

async function encryptTokens(tokens: object, verifierHash: string): Promise<Pick<TicketSession, 'encryptedTokens' | 'iv'>> {
  const key = await importAesKey(verifierHash, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(tokens));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { encryptedTokens: bytesToBase64Url(new Uint8Array(encrypted)), iv: bytesToBase64Url(iv) };
}

async function decryptTokens(session: TicketSession, verifierHash: string): Promise<unknown> {
  const key = await importAesKey(verifierHash, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(base64UrlToArrayBuffer(session.iv)) },
    key,
    base64UrlToArrayBuffer(session.encryptedTokens),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
}

async function importAesKey(verifierHash: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToArrayBuffer(verifierHash), { name: 'AES-GCM' }, false, usages);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomBase64Url(length: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return await request.json<T>();
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function text(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: { ...JSON_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
