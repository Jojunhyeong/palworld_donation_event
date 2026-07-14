import { DonationEffect } from '../donation/effect-engine';
import { PalDefenderClient, PalDefenderConfig, PalDefenderPlayer } from './paldefender-client';

const COMMON_ITEMS = ['Wood', 'Stone', 'Fiber', 'Leather', 'Wool'] as const;
const RARE_ITEMS = ['Diamond', 'Pal_crystal_S', 'PalSphere_Giga'] as const;
const HELP_ITEMS = [
  [{ ItemID: 'PalSphere_Tera', Count: 10 }],
  [{ ItemID: 'Shield_03', Count: 1 }],
  [{ ItemID: 'HandGun_Default_3', Count: 1 }, { ItemID: 'HandgunBullet', Count: 100 }],
  [{ ItemID: 'AssaultRifle_Default3', Count: 1 }, { ItemID: 'AssaultRifleBullet', Count: 200 }],
] as const;

export interface ExecutedEffect {
  player: PalDefenderPlayer;
  detail: string;
}

export async function executeDonationEffect(effect: DonationEffect, config: PalDefenderConfig): Promise<ExecutedEffect> {
  const client = new PalDefenderClient(config);
  const players = await client.getPlayers();
  const player = selectStreamer(players, config.playerId);
  const target = player.UserId || player.PlayerUID;
  if (!target) throw new Error('스트리머 캐릭터의 ID를 확인할 수 없습니다.');
  const connectedConfig = { ...config, playerId: target };
  const connectedClient = new PalDefenderClient(connectedConfig);

  switch (effect.kind) {
    case 'meat':
      await connectedClient.giveItems([{ ItemID: 'Meat_ChickenPal', Count: 5 }]);
      return { player, detail: '닭고기 5개를 지급했습니다.' };
    case 'common_item': {
      const item = pick(COMMON_ITEMS);
      await connectedClient.giveItems([{ ItemID: item, Count: 10 }]);
      return { player, detail: `${item} 10개를 지급했습니다.` };
    }
    case 'rare_item': {
      const item = pick(RARE_ITEMS);
      await connectedClient.giveItems([{ ItemID: item, Count: 1 }]);
      return { player, detail: `${item} 1개를 지급했습니다.` };
    }
    case 'help_item': {
      const items = pick(HELP_ITEMS).map((item) => ({ ...item }));
      await connectedClient.giveItems(items);
      return { player, detail: '도움 아이템을 지급했습니다.' };
    }
    case 'obstruction':
      return executeObstruction(effect, connectedClient, player);
    case 'death':
      throw new Error('즉사 효과는 안전한 서버 명령이 없어 아직 사용할 수 없습니다.');
  }
}

function selectStreamer(players: PalDefenderPlayer[], configuredPlayerId: string): PalDefenderPlayer {
  if (configuredPlayerId) {
    const configured = players.find((player) => player.UserId === configuredPlayerId || player.PlayerUID === configuredPlayerId);
    if (configured) return configured;
  }
  const online = players.filter((player) => /online|connected/i.test(player.Status ?? ''));
  if (online.length === 1) return online[0];
  if (players.length === 1) return players[0];
  if (online.length > 0) return online[0];
  throw new Error('게임에 접속한 스트리머 캐릭터를 찾지 못했습니다.');
}

async function executeObstruction(
  effect: DonationEffect,
  client: PalDefenderClient,
  player: PalDefenderPlayer,
): Promise<ExecutedEffect> {
  const target = player.UserId || player.PlayerUID;
  if (effect.label === '가방 쓰레기 채우기') {
    const item = pick(COMMON_ITEMS);
    await client.giveItems([{ ItemID: item, Count: 100 }]);
    return { player, detail: `${item} 100개로 가방을 방해했습니다.` };
  }

  const location = player.MapLocation ?? player.WorldLocation;
  if (!location) throw new Error('스트리머의 현재 위치를 확인할 수 없습니다.');
  if (effect.label === '랜덤 이동') {
    const x = Math.round(location.x + randomBetween(-350, 350));
    const y = Math.round(location.y + randomBetween(-350, 350));
    await client.sendRcon(`/tp ${target} ${x} ${y}`);
    return { player, detail: '스트리머를 주변의 무작위 위치로 이동했습니다.' };
  }

  const z = Math.round(location.z + 1_500);
  await client.sendRcon(`/tp ${target} ${Math.round(location.x)} ${Math.round(location.y)} ${z}`);
  return { player, detail: '스트리머를 공중으로 이동했습니다.' };
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
