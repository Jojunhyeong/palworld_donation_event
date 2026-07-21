import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { ChzzkAuthTokens } from '../types';

export type AppMode = 'personal' | 'party-host';

export interface PartyMemberCredentials extends ChzzkAuthTokens {
  memberId: string;
  playerName: string;
}

interface StoredPartyMember {
  memberId: string;
  playerName: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
}

interface StoredConfig {
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  palDefenderUrl?: string;
  palDefenderTokenEncrypted?: string;
  rconPasswordEncrypted?: string;
  rconPort?: number;
  palworldServerDir?: string;
  palworldPlayerId?: string;
  testMode?: boolean;
  palworldGameWin64Dir?: string;
  appMode?: AppMode;
  partyMembers?: StoredPartyMember[];
}

export interface PublicConfig {
  clientModInstalled: boolean;
  appMode: AppMode;
  partyMembers: Array<{ memberId: string; playerName: string }>;
}

export class SecureConfigStore {
  private get filePath(): string {
    return path.join(app.getPath('userData'), 'config.json');
  }

  async getPublicConfig(): Promise<PublicConfig> {
    const stored = await this.read();
    return {
      clientModInstalled: Boolean(stored.palworldGameWin64Dir),
      appMode: stored.appMode ?? 'personal',
      partyMembers: (stored.partyMembers ?? []).map(({ memberId, playerName }) => ({ memberId, playerName })),
    };
  }

  async saveAppMode(appMode: AppMode): Promise<void> {
    const current = await this.read();
    await this.write({ ...current, appMode });
  }

  async getPartyMembers(): Promise<PartyMemberCredentials[]> {
    const stored = await this.read();
    return (stored.partyMembers ?? []).map((member) => ({
      memberId: member.memberId,
      playerName: member.playerName,
      accessToken: this.decrypt(member.accessTokenEncrypted),
      refreshToken: member.refreshTokenEncrypted ? this.decrypt(member.refreshTokenEncrypted) : undefined,
    }));
  }

  async savePartyMember(member: PartyMemberCredentials): Promise<void> {
    const current = await this.read();
    const next = (current.partyMembers ?? []).filter((stored) => stored.playerName !== member.playerName);
    next.push({
      memberId: member.memberId,
      playerName: member.playerName,
      accessTokenEncrypted: this.encrypt(member.accessToken),
      refreshTokenEncrypted: member.refreshToken ? this.encrypt(member.refreshToken) : undefined,
    });
    await this.write({ ...current, partyMembers: next });
  }

  async removePartyMember(memberId: string): Promise<void> {
    const current = await this.read();
    await this.write({
      ...current,
      partyMembers: (current.partyMembers ?? []).filter((member) => member.memberId !== memberId),
    });
  }

  async saveClientModConfig(gameWin64Dir: string): Promise<void> {
    const current = await this.read();
    await this.write({ ...current, palworldGameWin64Dir: gameWin64Dir });
  }

  async getClientModConfig(): Promise<{ gameWin64Dir: string }> {
    const stored = await this.read();
    return { gameWin64Dir: stored.palworldGameWin64Dir ?? '' };
  }

  async saveTokens(tokens: ChzzkAuthTokens): Promise<void> {
    const current = await this.read();
    await this.write({
      ...current,
      accessTokenEncrypted: this.encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? this.encrypt(tokens.refreshToken) : undefined,
    });
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('운영체제의 보안 저장소를 사용할 수 없습니다.');
    }
    return safeStorage.encryptString(value).toString('base64');
  }

  private decrypt(value: string): string {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }

  private async read(): Promise<StoredConfig> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as StoredConfig & {
        clientId?: string;
        redirectUri?: string;
        clientSecretEncrypted?: string;
        palworldServerName?: string;
      };
      const {
        clientId: _clientId,
        redirectUri: _redirectUri,
        clientSecretEncrypted: _clientSecret,
        palworldServerName: _serverName,
        ...stored
      } = parsed;
      return stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async write(config: StoredConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  }
}
