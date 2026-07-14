import io from 'socket.io-client';
import axios from 'axios';
import { ChatEvent, DonationEvent } from '../types';
import { getSafeErrorMessage } from './api-error';

interface SystemMessage {
  type?: string;
  data?: {
    sessionKey?: string;
  };
  sessionKey?: string;
}

export interface DonationListenerHandlers {
  onStatus?: (status: 'connected' | 'disconnected') => void;
  onChat?: (chat: ChatEvent) => void;
  onDonation?: (donation: DonationEvent) => void;
  onLog?: (message: string) => void;
  onError?: (message: string) => void;
}

export function connectDonationListener(
  sessionUrl: string,
  accessToken: string,
  handlers: DonationListenerHandlers = {},
): SocketIOClient.Socket {
  const socket = io(sessionUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on('connect', async () => {
    handlers.onLog?.('세션 연결 성공');
    handlers.onStatus?.('connected');
  });

  socket.on('disconnect', () => handlers.onStatus?.('disconnected'));

  socket.on('SYSTEM', async (message: unknown) => {
    const systemMessage = parseSocketMessage<SystemMessage>(message);

    if (!systemMessage) {
      handlers.onError?.('SYSTEM 메시지를 해석하지 못했습니다.');
      return;
    }

    const sessionKey = systemMessage?.data?.sessionKey ?? systemMessage?.sessionKey;

    if (sessionKey) {
      await subscribeEvents(accessToken, sessionKey, handlers);
    }

    handlers.onLog?.(`SYSTEM: ${typeof message === 'string' ? message : JSON.stringify(message)}`);
  });

  socket.on('CHAT', (message: unknown) => {
    const chat = parseSocketMessage<ChatEvent>(message);

    if (!chat) {
      handlers.onError?.('CHAT 메시지를 해석하지 못했습니다.');
      return;
    }

    console.log('💬 채팅 메시지 발생');
    console.log(`닉네임 : ${chat.profile?.nickname ?? '알 수 없음'}`);
    console.log(`메시지 : ${chat.content ?? '-'}`);
    handlers.onChat?.(chat);
  });

  socket.on('DONATION', (message: unknown) => {
    const donation = parseSocketMessage<DonationEvent>(message);

    if (!donation) {
      handlers.onError?.('DONATION 메시지를 해석하지 못했습니다.');
      return;
    }

    const donationType = String(donation.donationType ?? '').toUpperCase();

    if (donationType && donationType !== 'CHAT') {
      console.log(`다른 후원 타입 무시: ${donationType}`);
      return;
    }

    console.log('🎉 채팅 후원 발생');
    console.log(`닉네임 : ${donation.donatorNickname ?? '익명'}`);
    console.log(`금액 : ${donation.payAmount ?? '0'}원`);
    console.log(`메시지 : ${donation.donationText ?? '-'}`);
    handlers.onDonation?.(donation);
  });

  socket.on('connect_error', (error: Error) => {
    handlers.onError?.(`연결 오류: ${error.message}`);
  });

  return socket;
}

function parseSocketMessage<T extends object>(message: unknown): T | null {
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message) as unknown;
      return parsed !== null && typeof parsed === 'object' ? (parsed as T) : null;
    } catch {
      return null;
    }
  }

  return message !== null && typeof message === 'object' ? (message as T) : null;
}

async function subscribeEvents(
  accessToken: string,
  sessionKey: string,
  handlers: DonationListenerHandlers,
): Promise<void> {
  await Promise.all([
    subscribeEvent(accessToken, sessionKey, 'chat', '채팅', handlers),
    subscribeEvent(accessToken, sessionKey, 'donation', '후원', handlers),
  ]);
}

async function subscribeEvent(
  accessToken: string,
  sessionKey: string,
  eventPath: 'chat' | 'donation',
  eventName: string,
  handlers: DonationListenerHandlers,
): Promise<void> {
  try {
    await axios.post(
      `https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/${eventPath}`,
      null,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          sessionKey,
        },
        timeout: 10_000,
      },
    );
    handlers.onLog?.(`${eventName} 이벤트 구독 요청 완료`);
  } catch (error) {
    handlers.onError?.(getSafeErrorMessage(error, `${eventName} 이벤트 구독 실패`));
  }
}
