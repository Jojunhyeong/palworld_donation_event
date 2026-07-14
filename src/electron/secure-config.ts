import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { ChzzkAuthTokens } from '../types';
import { PalDefenderConfig } from '../palworld/paldefender-client';

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
}

export interface PublicConfig {
  palDefenderUrl: string;
  hasPalDefenderToken: boolean;
  palworldPlayerId: string;
  testMode: boolean;
  serverInstalled: boolean;
}

export class SecureConfigStore {
  private get filePath(): string {
    return path.join(app.getPath('userData'), 'config.json');
  }

  async getPublicConfig(): Promise<PublicConfig> {
    const stored = await this.read();
    return {
      palDefenderUrl: stored.palDefenderUrl ?? 'http://127.0.0.1:17993',
      hasPalDefenderToken: Boolean(stored.palDefenderTokenEncrypted),
      palworldPlayerId: stored.palworldPlayerId ?? '',
      testMode: stored.testMode ?? true,
      serverInstalled: Boolean(stored.palworldServerDir),
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
    const rconPasswordEncrypted = input.rconPassword ? this.encrypt(input.rconPassword) : current.rconPasswordEncrypted;
    await this.write({
      ...current,
      palDefenderUrl: input.baseUrl,
      palDefenderTokenEncrypted: tokenEncrypted,
      rconPasswordEncrypted,
      rconPort: input.rconPort ?? current.rconPort,
      palworldServerDir: input.serverDir ?? current.palworldServerDir,
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
      rconPassword: stored.rconPasswordEncrypted ? this.decrypt(stored.rconPasswordEncrypted) : '',
      rconPort: stored.rconPort ?? 25575,
      serverDir: stored.palworldServerDir ?? '',
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
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as StoredConfig & {
        clientId?: string;
        redirectUri?: string;
        clientSecretEncrypted?: string;
      };
      const { clientId: _clientId, redirectUri: _redirectUri, clientSecretEncrypted: _clientSecret, ...stored } = parsed;
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
