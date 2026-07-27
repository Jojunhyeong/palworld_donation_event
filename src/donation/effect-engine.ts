export type EffectKind = 'meat' | 'common_item' | 'rare_item' | 'obstruction' | 'help_item' | 'death';

export interface DonationEffect {
  amount: number;
  kind: EffectKind;
  label: string;
  detail: string;
  implemented: boolean;
}

const OBSTRUCTIONS = [
  { label: '가방 방해', detail: '일반 아이템 100개를 무작위로 지급' },
] as const;

export function resolveDonationEffect(value: string | number): DonationEffect | null {
  const amount = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9]/g, ''));
  if (!Number.isFinite(amount)) return null;

  switch (amount) {
    case 1000:
      return { amount, kind: 'meat', label: '고기 5개', detail: '고기 아이템 5개 지급', implemented: true };
    case 3000:
      return { amount, kind: 'common_item', label: '일반 아이템 랜덤', detail: '일반 아이템 목록에서 1개 추첨', implemented: true };
    case 5000:
      return { amount, kind: 'rare_item', label: '고급 아이템 랜덤', detail: '고급 아이템 목록에서 1개 추첨', implemented: true };
    case 8000: {
      const picked = OBSTRUCTIONS[Math.floor(Math.random() * OBSTRUCTIONS.length)];
      return { amount, kind: 'obstruction', ...picked, implemented: true };
    }
    case 10000:
      return { amount, kind: 'help_item', label: '도움주기 랜덤', detail: '풀피·방어구·무기 중 1개 추첨', implemented: true };
    case 50000:
      return { amount, kind: 'death', label: '즉사', detail: '스트리머 캐릭터 사망 처리', implemented: true };
    default:
      return null;
  }
}
