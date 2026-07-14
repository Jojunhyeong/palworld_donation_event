import axios, { AxiosInstance } from 'axios';

export interface PalDefenderConfig {
  baseUrl: string;
  token: string;
  playerId: string;
  testMode: boolean;
}

export interface PalDefenderPlayer {
  Name: string;
  PlayerUID: string;
  UserId: string;
  Status: string;
}

interface PlayersResponse {
  Players?: PalDefenderPlayer[];
}

export class PalDefenderClient {
  private readonly http: AxiosInstance;

  constructor(private readonly config: PalDefenderConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ''),
      timeout: 8_000,
      headers: { Authorization: `Bearer ${config.token}` },
    });
  }

  async getVersion(): Promise<unknown> {
    const response = await this.http.get('/v1/pdapi/version');
    return response.data;
  }

  async getPlayers(): Promise<PalDefenderPlayer[]> {
    const response = await this.http.get<PlayersResponse>('/v1/pdapi/players');
    return response.data?.Players ?? [];
  }

  async giveItems(items: Array<{ ItemID: string; Count: number }>): Promise<void> {
    if (!this.config.playerId) throw new Error('스트리머 캐릭터를 선택해 주세요.');
    await this.http.post(`/v1/pdapi/give/items/${encodeURIComponent(this.config.playerId)}`, { Items: items });
  }
}
