export interface CimeAuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface CimeTokenResponse {
  content?: CimeAuthTokens & {
    tokenType?: string;
    expiresIn?: string | number;
    scope?: string;
  };
}

export interface CimeSessionResponse {
  content?: {
    url?: string;
  };
}

export interface DonationEvent {
  donationType?: string;
  channelId?: string;
  donatorChannelId?: string;
  donatorNickname?: string;
  payAmount?: string | number;
  donationText?: string;
  emojis?: Record<string, string>;
  cheeringItems?: unknown[];
}
