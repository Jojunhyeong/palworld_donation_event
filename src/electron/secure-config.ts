import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { ChzzkAuthTokens } from '../types';
import { ChzzkAuthConfig } from '../chzzk/auth';
import { PalDefenderConfig } from '../palworld/paldefender-client';

interface StoredConfig {
  clientId?: string;
  redirectUri?: string;
  clientSecretEncrypted?: string;
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  palDefenderUrl?: string;
  palDefenderTokenEncrypted?: string;
  palworldPlayerId?: string;
  testMode?: boolean;
}

export interface PublicConfig {
  clientId: string;
  redirectUri: string;
  hasClientSecret: boolean;
  palDefenderUrl: string;
  hasPalDefenderToken: boolean;
  palworldPlayerId: string;
  testMode: boolean;
}

export class SecureConfigStore {
  private get filePath(): string {
    return path.join(app.getPath('userData'), 'config.json');
  }

  async getPublicConfig(): Promise<PublicConfig> {
    const stored = await this.read();
    return {
      clientId: stored.clientId ?? '',
      redirectUri: stored.redirectUri ?? 'http://localhost:3000/auth/callback',
      hasClientSecret: Boolean(stored.clientSecretEncrypted),
      palDefenderUrl: stored.palDefenderUrl ?? 'http://127.0.0.1:17993',
      hasPalDefenderToken: Boolean(stored.palDefenderTokenEncrypted),
      palworldPlayerId: stored.palworldPlayerId ?? '',
      testMode: stored.testMode ?? true,
    };
  }

  async saveAuthConfig(input: ChzzkAuthConfig): Promise<void> {
    const current = await this.read();
    const clientSecretEncrypted = input.clientSecret
      ? this.encrypt(input.clientSecret)
      : current.clientSecretEncrypted;

    if (!clientSecretEncrypted) {
      throw new Error('Client Secret을 입력해 주세요.');
    }

    await this.write({
      ...current,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      clientSecretEncrypted,
    });
  }

  async getAuthConfig(): Promise<ChzzkAuthConfig> {
    const stored = await this.read();
    if (!stored.clientId || !stored.redirectUri || !stored.clientSecretEncrypted) {
      throw new Error('치지직 앱 설정을 먼저 저장해 주세요.');
    }

    return {
      clientId: stored.clientId,
      redirectUri: stored.redirectUri,
      clientSecret: this.decrypt(stored.clientSecretEncrypted),
    };
  }

  async saveTokens(tokens: ChzzkAuthTokens): Promise<void> {
    const current = await this.read();
    await this.write({
      ...current,
      accessTokenEncrypted: this.encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? this.encrypt(tokens.refreshToken) : undefined,
    });
  }

  async savePalDefenderConfig(input: PalDefenderConfig): Promise<void> {
    const current = await this.read();
    const tokenEncrypted = input.token ? this.encrypt(input.token) : current.palDefenderTokenEncrypted;
    await this.write({
      ...current,
      palDefenderUrl: input.baseUrl,
      palDefenderTokenEncrypted: tokenEncrypted,
      palworldPlayerId: input.playerId,
      testMode: input.testMode,
    });
  }

  async getPalDefenderConfig(): Promise<PalDefenderConfig> {
    const stored = await this.read();
    return {
      baseUrl: stored.palDefenderUrl ?? 'http://127.0.0.1:17993',
      token: stored.palDefenderTokenEncrypted ? this.decrypt(stored.palDefenderTokenEncrypted) : '',
      playerId: stored.palworldPlayerId ?? '',
      testMode: stored.testMode ?? true,
    };
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
      return JSON.parse(await fs.readFile(this.filePath, 'utf8')) as StoredConfig;
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
