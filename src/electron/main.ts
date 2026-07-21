import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import path from 'path';
import { authorizeWithRemoteService } from '../chzzk/remote-auth';
import { createChzzkSession } from '../chzzk/session';
import { connectDonationListener } from '../chzzk/donation-listener';
import { getSafeErrorMessage } from '../chzzk/api-error';
import { AppMode, PartyMemberCredentials, SecureConfigStore } from './secure-config';
import { PalworldClientModManager } from '../palworld/client-mod-manager';
import { executeClientDonationEffect } from '../palworld/client-effect-executor';
import { resolveDonationEffect } from '../donation/effect-engine';
import { AUTH_SERVICE_URL } from '../config/product';
import { LocalPartyHub } from '../chzzk/party-hub';

let mainWindow: BrowserWindow | null = null;
let socket: SocketIOClient.Socket | null = null;
const configStore = new SecureConfigStore();
let palworldManager: PalworldClientModManager | null = null;
let partyHub: LocalPartyHub | null = null;

function sendEvent(type: string, payload: unknown): void {
  mainWindow?.webContents.send('app:event', { type, payload });
}

function assertTrustedSender(url: string): void {
  if (!url.startsWith('file://')) {
    throw new Error('허용되지 않은 화면에서의 요청입니다.');
  }
}

function registerIpc(): void {
  ipcMain.handle('config:get', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    return configStore.getPublicConfig();
  });

  ipcMain.handle('mode:set', async (event, mode: AppMode) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    if (!['personal', 'party-host'].includes(mode)) throw new Error('지원하지 않는 실행 모드입니다.');
    if (mode === 'personal') await partyHub?.stop();
    await configStore.saveAppMode(mode);
    sendEvent('mode', { mode });
    return { ok: true };
  });

  ipcMain.handle('party:start', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    try {
      if (!partyHub) throw new Error('파티 중앙 수신기를 시작하지 못했습니다.');
      await configStore.saveAppMode('party-host');
      const session = await partyHub.start(await configStore.getPartyMembers());
      sendEvent('party', { status: 'running', ...session });
      return { ok: true, ...session };
    } catch (error) {
      const message = getSafeErrorMessage(error, '파티를 시작하지 못했습니다.');
      sendEvent('party', { status: 'error', message });
      return { ok: false, message };
    }
  });

  ipcMain.handle('party:stop', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    await partyHub?.stop();
    sendEvent('party', { status: 'stopped' });
    return { ok: true };
  });

  ipcMain.handle('party:remove-member', async (event, memberId: string) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    partyHub?.removeMember(memberId);
    await configStore.removePartyMember(memberId);
    sendEvent('party-member', { memberId, removed: true });
    return { ok: true };
  });

  ipcMain.handle('party:list-players', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    try {
      if (!palworldManager) throw new Error('팰월드 모드 관리자를 시작하지 못했습니다.');
      const players = await palworldManager.listPlayers(await configStore.getClientModConfig());
      return { ok: true, players };
    } catch (error) {
      return { ok: false, message: getSafeErrorMessage(error, '접속자 목록을 읽지 못했습니다.') };
    }
  });

  ipcMain.handle('party:test-target', async (event, playerName: string) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    if (!playerName?.trim()) return { ok: false, message: '대상 캐릭터 이름이 없습니다.' };
    return emitEffect(1_000, '파티 대상 테스트', playerName.trim());
  });

  ipcMain.handle('clipboard:write', (event, value: string) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    clipboard.writeText(value);
    return { ok: true };
  });

  ipcMain.handle('chzzk:connect', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    socket?.disconnect();
    socket = null;

    try {
      sendEvent('status', { chzzk: 'authorizing' });
      const tokens = await authorizeWithRemoteService(AUTH_SERVICE_URL, async (url) => {
        await shell.openExternal(url);
      });
      await configStore.saveTokens(tokens);

      sendEvent('status', { chzzk: 'connecting' });
      const sessionUrl = await createChzzkSession(tokens.accessToken);
      socket = connectDonationListener(sessionUrl, tokens.accessToken, {
        onStatus: (status) => sendEvent('status', { chzzk: status }),
        onLog: (message) => sendEvent('log', { level: 'info', message }),
        onError: (message) => sendEvent('log', { level: 'error', message }),
        onChat: (chat) => sendEvent('chat', chat),
        onDonation: (donation) => {
          sendEvent('donation', donation);
          void emitEffect(donation.payAmount ?? 0, '후원');
        },
      });
      return { ok: true };
    } catch (error) {
      const message = getSafeErrorMessage(error, '치지직 연결에 실패했습니다.');
      sendEvent('status', { chzzk: 'error' });
      sendEvent('log', { level: 'error', message });
      return { ok: false, message };
    }
  });

  ipcMain.handle('chzzk:disconnect', (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    socket?.disconnect();
    socket = null;
    sendEvent('status', { chzzk: 'disconnected' });
  });

  ipcMain.handle('palworld:test', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    try {
      if (!palworldManager) throw new Error('팰월드 모드 관리자를 시작하지 못했습니다.');
      const config = await configStore.getClientModConfig();
      const status = await palworldManager.status(config);
      if (!status.installed) throw new Error('일반 초대방 모드를 먼저 설치해 주세요.');
      if (!status.gameRunning) throw new Error('팰월드를 실행하고 멀티플레이 월드에 들어가 주세요.');
      if (!status.compatible) {
        throw new Error('설치된 방장 모드가 구버전입니다. 팰월드를 종료하고 방장 모드를 다시 설치한 뒤 재실행해 주세요.');
      }
      sendEvent('status', { palworld: 'connected' });
      return { ok: true };
    } catch (error) {
      const message = getSafeErrorMessage(error, '팰월드 초대방 연결에 실패했습니다.');
      sendEvent('status', { palworld: 'error' });
      return { ok: false, message };
    }
  });

  ipcMain.handle('effect:test', async (event, amount: number) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    return emitEffect(amount, '테스트');
  });

  ipcMain.handle('palworld:prepare', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    try {
      if (!palworldManager) throw new Error('팰월드 모드 관리자를 시작하지 못했습니다.');
      sendEvent('status', { palworld: 'preparing' });
      const config = await palworldManager.prepare((message) => sendEvent('log', { level: 'info', message }));
      await configStore.saveClientModConfig(config.gameWin64Dir);
      sendEvent('status', { palworld: 'ready' });
      return { ok: true, message: '일반 초대방용 방장 모드를 설치했습니다. 팰월드를 완전히 다시 실행해 주세요.' };
    } catch (error) {
      const message = getSafeErrorMessage(error, '방장 모드 자동 설치에 실패했습니다.');
      sendEvent('status', { palworld: 'error' });
      return { ok: false, message };
    }
  });
}

async function emitEffect(
  amount: string | number,
  source: string,
  targetPlayerName?: string,
): Promise<{ ok: boolean; message?: string }> {
  const effect = resolveDonationEffect(amount);
  if (!effect) return { ok: false, message: '해당 금액에 등록된 효과가 없습니다.' };
  try {
    if (!palworldManager) throw new Error('팰월드 모드 관리자를 시작하지 못했습니다.');
    const config = await configStore.getClientModConfig();
    const detail = await executeClientDonationEffect(effect, palworldManager, config, targetPlayerName);
    sendEvent('effect', { ...effect, detail, source, mode: 'live', targetPlayerName });
    return { ok: true };
  } catch (error) {
    const message = getSafeErrorMessage(error, '팰월드 효과 실행에 실패했습니다.');
    sendEvent('log', { level: 'error', message });
    return { ok: false, message };
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#0d1117',
    title: '팰 후원 브리지',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  void mainWindow.loadFile(path.join(app.getAppPath(), 'src/electron/renderer/index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  palworldManager = new PalworldClientModManager(path.join(app.getPath('userData'), 'client-mod'));
  partyHub = new LocalPartyHub(AUTH_SERVICE_URL, {
    onDonation: (member, donation) => {
      sendEvent('party-donation', { memberId: member.memberId, playerName: member.playerName, donation });
      void emitEffect(donation.payAmount ?? 0, `${member.playerName} 방송 후원`, member.playerName);
    },
    onMemberJoined: async (member: PartyMemberCredentials) => {
      const replaced = (await configStore.getPartyMembers()).find(
        (stored) => stored.playerName === member.playerName && stored.memberId !== member.memberId,
      );
      await configStore.savePartyMember(member);
      if (replaced) sendEvent('party-member', { memberId: replaced.memberId, removed: true });
      sendEvent('party-member', { memberId: member.memberId, playerName: member.playerName, status: 'connecting' });
    },
    onMemberStatus: (member, status) => {
      sendEvent('party-member', { memberId: member.memberId, playerName: member.playerName, status });
    },
    onLog: (message) => sendEvent('log', { level: 'info', message }),
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  socket?.disconnect();
  void partyHub?.stop();
  if (process.platform !== 'darwin') app.quit();
});
