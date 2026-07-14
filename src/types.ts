export interface ChzzkAuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface ChzzkTokenResponse {
  content?: ChzzkAuthTokens & {
    tokenType?: string;
    expiresIn?: string | number;
    scope?: string;
  };
}

export interface ChzzkSessionResponse {
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
}

export interface ChatEvent {
  channelId?: string;
  senderChannelId?: string;
  profile?: {
    nickname?: string;
  };
  content?: string;
  messageTime?: number;
}
