import { DonationEffect } from '../donation/effect-engine';
import { ClientModConfig, PalworldClientModManager } from './client-mod-manager';

const COMMON_ITEMS = [
  { id: 'Wood', name: '목재' },
  { id: 'Stone', name: '돌' },
  { id: 'Fiber', name: '섬유' },
  { id: 'Leather', name: '가죽' },
  { id: 'Wool', name: '양털' },
] as const;

const RARE_ITEMS = [
  { id: 'Diamond', name: '다이아몬드' },
  { id: 'Pal_crystal_S', name: '팰지움 파편' },
  { id: 'PalSphere_Giga', name: '기가 스피어' },
] as const;

type HelpEffect =
  | { kind: 'heal'; detail: string }
  | { kind: 'items'; items: Array<{ id: string; count: number }>; detail: string }
  | { kind: 'weapon' };

const HELP_WEAPONS = [
  {
    items: [{ id: 'HandGun_Default_3', count: 1 }, { id: 'HandgunBullet', count: 100 }],
    detail: '권총과 탄약 100발을 지급했습니다.',
  },
  {
    items: [{ id: 'AssaultRifle_Default3', count: 1 }, { id: 'AssaultRifleBullet', count: 200 }],
    detail: '돌격소총과 탄약 200발을 지급했습니다.',
  },
] as const;

const HELP_EFFECTS: readonly HelpEffect[] = [
  { kind: 'heal', detail: '대상 캐릭터의 체력을 모두 회복했습니다.' },
  { kind: 'items', items: [{ id: 'Shield_03', count: 1 }], detail: '고급 방어구를 지급했습니다.' },
  { kind: 'weapon' },
];

export async function executeClientDonationEffect(
  effect: DonationEffect,
  manager: PalworldClientModManager,
  config: ClientModConfig,
  targetPlayerName?: string,
): Promise<string> {
  switch (effect.kind) {
    case 'meat':
      await manager.giveItem(config, 'Meat_ChickenPal', 5, targetPlayerName);
      return '대상 캐릭터에게 닭고기 5개를 지급했습니다.';
    case 'common_item': {
      const item = pick(COMMON_ITEMS);
      await manager.giveItem(config, item.id, 10, targetPlayerName);
      return `${item.name} 10개를 지급했습니다.`;
    }
    case 'rare_item': {
      const item = pick(RARE_ITEMS);
      await manager.giveItem(config, item.id, 1, targetPlayerName);
      return `${item.name} 1개를 지급했습니다.`;
    }
    case 'obstruction':
      return executeObstruction(effect, manager, config, targetPlayerName);
    case 'help_item':
      return executeHelp(manager, config, targetPlayerName);
    case 'death':
      await manager.killPlayer(config, targetPlayerName);
      return '대상 캐릭터를 사망 처리했습니다.';
  }
}

async function executeObstruction(
  effect: DonationEffect,
  manager: PalworldClientModManager,
  config: ClientModConfig,
  targetPlayerName?: string,
): Promise<string> {
  if (effect.label === '슈퍼 점프') {
    await manager.superJump(config, targetPlayerName);
    return '대상 캐릭터를 슈퍼점프시켰습니다.';
  }
  if (effect.label === '랜덤 이동') {
    await manager.randomMove(config, targetPlayerName);
    return '대상 캐릭터를 주변의 무작위 위치로 이동했습니다.';
  }
  await manager.deleteRandomItem(config, targetPlayerName);
  return '일반 가방에서 아이템 한 묶음을 무작위로 삭제했습니다.';
}

async function executeHelp(
  manager: PalworldClientModManager,
  config: ClientModConfig,
  targetPlayerName?: string,
): Promise<string> {
  const effect = pick(HELP_EFFECTS);
  if (effect.kind === 'heal') {
    await manager.fullHeal(config, targetPlayerName);
    return effect.detail;
  }
  if (effect.kind === 'weapon') {
    const weapon = pick(HELP_WEAPONS);
    for (const item of weapon.items) await manager.giveItem(config, item.id, item.count, targetPlayerName);
    return weapon.detail;
  }
  for (const item of effect.items) await manager.giveItem(config, item.id, item.count, targetPlayerName);
  return effect.detail;
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}
