interface Env {
  CHZZK_CLIENT_ID: string;
  CHZZK_CLIENT_SECRET: string;
  CHZZK_REDIRECT_URI: string;
  OAUTH_SESSIONS: KVNamespace;
}

interface PendingSession {
  localState: string;
  verifierHash: string;
  flow?: 'personal' | 'party';
  partyCode?: string;
  playerName?: string;
}

interface TicketSession extends PendingSession {
  encryptedTokens: string;
  iv: string;
}

interface PartySession {
  verifierHash: string;
}

interface PartyTicket {
  playerName: string;
  memberId: string;
  encryptedTokens: string;
  iv: string;
}

interface ChzzkTokenResponse {
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

    if (request.method === 'POST' && url.pathname === '/auth/refresh') {
      return refreshTokens(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/party/create') {
      return createParty(request, url, env);
    }

    if (request.method === 'GET' && url.pathname === '/party/join') {
      return showPartyJoin(url, env);
    }

    if (request.method === 'POST' && url.pathname === '/party/join/start') {
      return startPartyAuthorization(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/party/claim') {
      return claimPartyMembers(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/party/close') {
      return closeParty(request, env);
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
  const pending: PendingSession = { localState, verifierHash, flow: 'personal' };
  await env.OAUTH_SESSIONS.put(`pending:${state}`, JSON.stringify(pending), { expirationTtl: 300 });

  const params = new URLSearchParams({
    clientId: env.CHZZK_CLIENT_ID,
    redirectUri: env.CHZZK_REDIRECT_URI,
    state,
  });

  return json({
    authorizationUrl: `https://chzzk.naver.com/account-interlock?${params.toString()}`,
  });
}

async function finishAuthorization(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return text('인증 요청이 올바르지 않습니다.', 400);

  const pendingKey = `pending:${state}`;
  const pending = await env.OAUTH_SESSIONS.get<PendingSession>(pendingKey, 'json');
  if (!pending) return text('인증 요청이 만료되었습니다. 앱에서 다시 시작해 주세요.', 400);

  const tokenResponse = await fetch('https://openapi.chzzk.naver.com/auth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'authorization_code',
      clientId: env.CHZZK_CLIENT_ID,
      clientSecret: env.CHZZK_CLIENT_SECRET,
      code,
      state,
    }),
  });
  const tokenBody = await tokenResponse.json<ChzzkTokenResponse>();
  if (!tokenResponse.ok || !tokenBody.content?.accessToken) {
    return text(`치지직 토큰 발급에 실패했습니다. (${tokenResponse.status})`, 502);
  }

  const encrypted = await encryptTokens(tokenBody.content, pending.verifierHash);

  if (pending.flow === 'party' && pending.partyCode && pending.playerName) {
    const memberId = crypto.randomUUID();
    const ticket = randomBase64Url(24);
    const partyTicket: PartyTicket = { playerName: pending.playerName, memberId, ...encrypted };
    await env.OAUTH_SESSIONS.put(`party-ticket:${pending.partyCode}:${ticket}`, JSON.stringify(partyTicket), {
      expirationTtl: 43_200,
    });
    await env.OAUTH_SESSIONS.delete(pendingKey);
    return html(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>파티 연결 완료</title><body style="font-family:system-ui;background:#0d1117;color:#f4f7fb;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:520px;padding:32px;text-align:center"><h1>파티 연결 완료</h1><p><b>${escapeHtml(pending.playerName)}</b> 캐릭터로 후원 연동을 등록했습니다.</p><p style="color:#9ba7b8">이 창을 닫아도 됩니다. 대표 방송인 프로그램에 잠시 후 표시됩니다.</p></main></body></html>`);
  }

  const ticket = randomBase64Url(32);
  const ticketSession: TicketSession = { ...pending, ...encrypted };
  await env.OAUTH_SESSIONS.put(`ticket:${ticket}`, JSON.stringify(ticketSession), { expirationTtl: 120 });
  await env.OAUTH_SESSIONS.delete(pendingKey);

  const callback = new URL(LOCAL_CALLBACK);
  callback.searchParams.set('ticket', ticket);
  callback.searchParams.set('state', pending.localState);
  return Response.redirect(callback.toString(), 302);
}

async function createParty(request: Request, url: URL, env: Env): Promise<Response> {
  const body = await readJson<{ partyCode?: string; verifierHash?: string }>(request);
  const partyCode = normalizePartyCode(body?.partyCode);
  const verifierHash = body?.verifierHash?.trim();
  if (!partyCode || !verifierHash || !isBase64Url(verifierHash)) return json({ error: 'INVALID_REQUEST' }, 400);

  const key = `party:${partyCode}`;
  if (await env.OAUTH_SESSIONS.get(key)) return json({ error: 'PARTY_CODE_IN_USE' }, 409);
  await env.OAUTH_SESSIONS.put(key, JSON.stringify({ verifierHash } satisfies PartySession), { expirationTtl: 43_200 });
  return json({ partyCode, joinUrl: `${url.origin}/party/join?code=${encodeURIComponent(partyCode)}` });
}

async function showPartyJoin(url: URL, env: Env): Promise<Response> {
  const partyCode = normalizePartyCode(url.searchParams.get('code'));
  if (!partyCode || !(await env.OAUTH_SESSIONS.get(`party:${partyCode}`))) {
    return html('<!doctype html><html lang="ko"><meta charset="utf-8"><title>파티 만료</title><body><h1>파티를 찾을 수 없습니다.</h1><p>대표 방송인에게 새 참여 링크를 받아 주세요.</p></body></html>', 404);
  }
  return html(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>팰 후원 파티 참여</title><body style="font-family:system-ui;background:#0d1117;color:#f4f7fb;display:grid;place-items:center;min-height:100vh;margin:0"><main style="width:min(440px,calc(100% - 40px));padding:32px;border:1px solid #26303d;border-radius:20px;background:#141a22"><p style="color:#00e676;font-weight:800">PAL DONATION BRIDGE</p><h1>파티 방송 연동</h1><p style="color:#9ba7b8">팰월드에서 사용하는 캐릭터 이름을 정확히 입력한 뒤 본인의 치지직 계정으로 로그인하세요.</p><form method="post" action="/party/join/start"><input type="hidden" name="partyCode" value="${partyCode}"><label style="display:grid;gap:8px;font-weight:700">팰월드 캐릭터 이름<input required maxlength="32" name="playerName" autocomplete="off" style="padding:13px;border-radius:10px;border:1px solid #303b4b;background:#0f141b;color:#fff"></label><button style="width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#00e676;color:#07130c;font-weight:900">치지직 로그인하고 참여</button></form></main></body></html>`);
}

async function startPartyAuthorization(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const partyCode = normalizePartyCode(String(form.get('partyCode') ?? ''));
  const playerName = String(form.get('playerName') ?? '').trim();
  if (!partyCode || !isValidPlayerName(playerName)) return text('파티 코드 또는 캐릭터 이름이 올바르지 않습니다.', 400);

  const party = await env.OAUTH_SESSIONS.get<PartySession>(`party:${partyCode}`, 'json');
  if (!party) return text('파티가 만료되었습니다. 대표 방송인에게 새 링크를 받아 주세요.', 410);
  const state = crypto.randomUUID();
  const pending: PendingSession = {
    localState: '',
    verifierHash: party.verifierHash,
    flow: 'party',
    partyCode,
    playerName,
  };
  await env.OAUTH_SESSIONS.put(`pending:${state}`, JSON.stringify(pending), { expirationTtl: 300 });
  const params = new URLSearchParams({ clientId: env.CHZZK_CLIENT_ID, redirectUri: env.CHZZK_REDIRECT_URI, state });
  return Response.redirect(`https://chzzk.naver.com/account-interlock?${params.toString()}`, 302);
}

async function claimPartyMembers(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ partyCode?: string; verifier?: string }>(request);
  const partyCode = normalizePartyCode(body?.partyCode);
  const verifier = body?.verifier?.trim();
  if (!partyCode || !verifier) return json({ error: 'INVALID_REQUEST' }, 400);
  const party = await env.OAUTH_SESSIONS.get<PartySession>(`party:${partyCode}`, 'json');
  if (!party || (await sha256Base64Url(verifier)) !== party.verifierHash) return json({ error: 'INVALID_PARTY' }, 401);

  const members: Array<{ memberId: string; playerName: string; accessToken: string; refreshToken?: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_SESSIONS.list({ prefix: `party-ticket:${partyCode}:`, cursor });
    for (const key of page.keys) {
      const ticket = await env.OAUTH_SESSIONS.get<PartyTicket>(key.name, 'json');
      if (!ticket) continue;
      const tokens = (await decryptTokens(ticket, party.verifierHash)) as { accessToken?: string; refreshToken?: string };
      if (tokens.accessToken) members.push({ memberId: ticket.memberId, playerName: ticket.playerName, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      await env.OAUTH_SESSIONS.delete(key.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ members });
}

async function closeParty(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ partyCode?: string; verifier?: string }>(request);
  const partyCode = normalizePartyCode(body?.partyCode);
  const verifier = body?.verifier?.trim();
  if (!partyCode || !verifier) return json({ error: 'INVALID_REQUEST' }, 400);
  const key = `party:${partyCode}`;
  const party = await env.OAUTH_SESSIONS.get<PartySession>(key, 'json');
  if (!party || (await sha256Base64Url(verifier)) !== party.verifierHash) return json({ error: 'INVALID_PARTY' }, 401);
  await env.OAUTH_SESSIONS.delete(key);
  return json({ ok: true });
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

async function refreshTokens(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ refreshToken?: string }>(request);
  const refreshToken = body?.refreshToken?.trim();
  if (!refreshToken || refreshToken.length > 2_048) return json({ error: 'INVALID_REQUEST' }, 400);
  const response = await fetch('https://openapi.chzzk.naver.com/auth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'refresh_token',
      refreshToken,
      clientId: env.CHZZK_CLIENT_ID,
      clientSecret: env.CHZZK_CLIENT_SECRET,
    }),
  });
  const result = await response.json<ChzzkTokenResponse>();
  if (!response.ok || !result.content?.accessToken) return json({ error: 'REFRESH_FAILED' }, 401);
  return json(result.content);
}

async function encryptTokens(tokens: object, verifierHash: string): Promise<Pick<TicketSession, 'encryptedTokens' | 'iv'>> {
  const key = await importAesKey(verifierHash, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(tokens));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { encryptedTokens: bytesToBase64Url(new Uint8Array(encrypted)), iv: bytesToBase64Url(iv) };
}

async function decryptTokens(session: Pick<TicketSession, 'encryptedTokens' | 'iv'>, verifierHash: string): Promise<unknown> {
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

function normalizePartyCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return /^[A-Z2-9]{6}$/.test(normalized) ? normalized : null;
}

function isValidPlayerName(value: string): boolean {
  return value.length >= 1 && value.length <= 32 && !/[|\r\n<>]/.test(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
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

function html(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: { ...JSON_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
