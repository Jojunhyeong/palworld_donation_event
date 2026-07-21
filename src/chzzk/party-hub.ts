import axios from 'axios';
import crypto from 'crypto';
import { connectDonationListener } from './donation-listener';
import { createChzzkSession } from './session';
import { DonationEvent } from '../types';
import { PartyMemberCredentials } from '../electron/secure-config';

interface PartyStartResponse {
  partyCode: string;
  joinUrl: string;
}

interface PartyClaimResponse {
  members?: PartyMemberCredentials[];
}

export interface PartyHubHandlers {
  onDonation(member: PartyMemberCredentials, donation: DonationEvent): void;
  onMemberJoined(member: PartyMemberCredentials): void | Promise<void>;
  onMemberStatus(member: PartyMemberCredentials, status: 'connected' | 'disconnected' | 'error'): void;
  onLog(message: string): void;
}

export interface PartySessionInfo {
  partyCode: string;
  joinUrl: string;
}

const PARTY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class LocalPartyHub {
  private sockets = new Map<string, SocketIOClient.Socket>();
  private memberNames = new Map<string, string>();
  private pollingTimer: NodeJS.Timeout | null = null;
  private partyCode = '';
  private verifier = '';
  private stopped = true;

  constructor(
    private readonly authServiceUrl: string,
    private readonly handlers: PartyHubHandlers,
  ) {}

  async start(storedMembers: PartyMemberCredentials[]): Promise<PartySessionInfo> {
    await this.stop();
    this.stopped = false;
    this.verifier = crypto.randomBytes(32).toString('base64url');
    const verifierHash = crypto.createHash('sha256').update(this.verifier).digest('base64url');
    const response = await this.createRemoteParty(verifierHash);
    if (!response.data?.joinUrl) throw new Error('파티 참여 링크를 만들지 못했습니다.');

    for (const member of storedMembers) void this.connectMember(member);
    this.scheduleClaim(500);
    return { partyCode: response.data.partyCode, joinUrl: response.data.joinUrl };
  }

  private async createRemoteParty(verifierHash: string): Promise<{ data: PartyStartResponse }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.partyCode = createPartyCode();
      try {
        return await axios.post<PartyStartResponse>(
          `${this.authServiceUrl.replace(/\/$/, '')}/party/create`,
          { partyCode: this.partyCode, verifierHash },
          { timeout: 10_000, headers: { 'Content-Type': 'application/json' } },
        );
      } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 409 || attempt === 2) throw error;
      }
    }
    throw new Error('사용 가능한 파티 코드를 만들지 못했습니다.');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollingTimer) clearTimeout(this.pollingTimer);
    this.pollingTimer = null;
    for (const socket of this.sockets.values()) socket.disconnect();
    this.sockets.clear();
    this.memberNames.clear();

    const partyCode = this.partyCode;
    const verifier = this.verifier;
    this.partyCode = '';
    this.verifier = '';
    if (partyCode && verifier) {
      try {
        await axios.post(
          `${this.authServiceUrl.replace(/\/$/, '')}/party/close`,
          { partyCode, verifier },
          { timeout: 5_000, headers: { 'Content-Type': 'application/json' } },
        );
      } catch {
        // 파티는 Worker의 TTL로 자동 만료됩니다.
      }
    }
  }

  removeMember(memberId: string): void {
    this.sockets.get(memberId)?.disconnect();
    this.sockets.delete(memberId);
    this.memberNames.delete(memberId);
  }

  private scheduleClaim(delay: number): void {
    if (this.stopped) return;
    this.pollingTimer = setTimeout(() => void this.claimMembers(), delay);
  }

  private async claimMembers(): Promise<void> {
    if (this.stopped || !this.partyCode || !this.verifier) return;
    try {
      const response = await axios.post<PartyClaimResponse>(
        `${this.authServiceUrl.replace(/\/$/, '')}/party/claim`,
        { partyCode: this.partyCode, verifier: this.verifier },
        { timeout: 10_000, headers: { 'Content-Type': 'application/json' } },
      );
      for (const member of response.data?.members ?? []) {
        await this.handlers.onMemberJoined(member);
        void this.connectMember(member);
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.handlers.onLog('파티 참여 링크가 만료되었습니다. 파티를 다시 시작해 주세요.');
        this.stopped = true;
        return;
      }
    }
    this.scheduleClaim(4_000);
  }

  private async connectMember(member: PartyMemberCredentials, allowRefresh = true): Promise<void> {
    for (const [memberId, playerName] of this.memberNames) {
      if (playerName === member.playerName && memberId !== member.memberId) this.removeMember(memberId);
    }
    this.sockets.get(member.memberId)?.disconnect();
    try {
      const sessionUrl = await createChzzkSession(member.accessToken);
      const socket = connectDonationListener(sessionUrl, member.accessToken, {
        onStatus: (status) => this.handlers.onMemberStatus(member, status),
        onDonation: (donation) => this.handlers.onDonation(member, donation),
        onError: (message) => {
          this.handlers.onMemberStatus(member, 'error');
          this.handlers.onLog(`${member.playerName}: ${message}`);
        },
      });
      this.sockets.set(member.memberId, socket);
      this.memberNames.set(member.memberId, member.playerName);
    } catch {
      if (allowRefresh && member.refreshToken) {
        try {
          const response = await axios.post<{ accessToken?: string; refreshToken?: string }>(
            `${this.authServiceUrl.replace(/\/$/, '')}/auth/refresh`,
            { refreshToken: member.refreshToken },
            { timeout: 10_000, headers: { 'Content-Type': 'application/json' } },
          );
          if (response.data.accessToken) {
            const refreshed = {
              ...member,
              accessToken: response.data.accessToken,
              refreshToken: response.data.refreshToken ?? member.refreshToken,
            };
            await this.handlers.onMemberJoined(refreshed);
            await this.connectMember(refreshed, false);
            return;
          }
        } catch {
          // 아래에서 재인증 안내 상태로 전환합니다.
        }
      }
      this.handlers.onMemberStatus(member, 'error');
      this.handlers.onLog(`${member.playerName} 방송 연결에 실패했습니다. 참여 링크에서 다시 인증해 주세요.`);
    }
  }
}

function createPartyCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += PARTY_ALPHABET[crypto.randomInt(PARTY_ALPHABET.length)];
  }
  return code;
}
