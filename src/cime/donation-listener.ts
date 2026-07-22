import axios from 'axios';
import { DonationEvent } from '../types';
import { getSafeErrorMessage } from './api-error';

const CIME_API_BASE = 'https://ci.me/api/openapi';
const PING_INTERVAL_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface CimeSocketMessage {
  action?: string;
  event?: string;
  data?: DonationEvent;
}

export interface DonationListenerHandlers {
  onStatus?: (status: 'connected' | 'disconnected') => void;
  onDonation?: (donation: DonationEvent) => void;
  onLog?: (message: string) => void;
  onError?: (message: string) => void;
}

export interface CimeDonationConnection {
  disconnect(): void;
}

export function connectDonationListener(
  sessionUrl: string,
  accessToken: string,
  handlers: DonationListenerHandlers = {},
): CimeDonationConnection {
  let socket: WebSocket | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  let manuallyClosed = false;

  const clearTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pingTimer = null;
    reconnectTimer = null;
  };

  const connect = () => {
    if (manuallyClosed) return;
    socket = new WebSocket(sessionUrl);

    socket.addEventListener('open', async () => {
      reconnectAttempts = 0;
      handlers.onStatus?.('connected');
      handlers.onLog?.('씨미 실시간 세션 연결 성공');
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'PING' }));
      }, PING_INTERVAL_MS);

      try {
        await subscribeDonation(accessToken, getSessionKey(sessionUrl));
        handlers.onLog?.('씨미 후원 이벤트 구독 완료');
      } catch (error) {
        handlers.onError?.(getSafeErrorMessage(error, '씨미 후원 이벤트 구독 실패'));
      }
    });

    socket.addEventListener('message', (event) => {
      const message = parseMessage(event.data);
      if (!message || message.action === 'PONG') return;
      if (message.event !== 'DONATION' || !message.data) return;
      handlers.onDonation?.(message.data);
    });

    socket.addEventListener('error', () => handlers.onError?.('씨미 실시간 세션 연결 오류가 발생했습니다.'));

    socket.addEventListener('close', () => {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      handlers.onStatus?.('disconnected');
      if (manuallyClosed || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
      reconnectAttempts += 1;
      const delay = Math.min(1_000 * 2 ** (reconnectAttempts - 1), 15_000);
      handlers.onLog?.(`씨미 세션 재연결 시도 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
      reconnectTimer = setTimeout(connect, delay);
    });
  };

  connect();

  return {
    disconnect() {
      manuallyClosed = true;
      clearTimers();
      socket?.close();
      socket = null;
    },
  };
}

async function subscribeDonation(accessToken: string, sessionKey: string): Promise<void> {
  await axios.post(`${CIME_API_BASE}/open/v1/sessions/events/subscribe/donation`, null, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    params: { sessionKey },
    timeout: 10_000,
  });
}

function getSessionKey(sessionUrl: string): string {
  const sessionKey = new URL(sessionUrl).searchParams.get('sessionKey');
  if (!sessionKey) throw new Error('씨미 세션 키가 없습니다.');
  return sessionKey;
}

function parseMessage(value: unknown): CimeSocketMessage | null {
  const text = typeof value === 'string' ? value : value instanceof ArrayBuffer ? Buffer.from(value).toString('utf8') : '';
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as CimeSocketMessage) : null;
  } catch {
    return null;
  }
}
