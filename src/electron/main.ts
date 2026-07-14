import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { authorizeWithRemoteService } from '../chzzk/remote-auth';
import { createChzzkSession } from '../chzzk/session';
import { connectDonationListener } from '../chzzk/donation-listener';
import { getSafeErrorMessage } from '../chzzk/api-error';
import { SecureConfigStore } from './secure-config';
import { PalDefenderClient } from '../palworld/paldefender-client';
import { executeDonationEffect } from '../palworld/effect-executor';
import { PalworldServerManager } from '../palworld/server-manager';
import { resolveDonationEffect } from '../donation/effect-engine';
import { AUTH_SERVICE_URL } from '../config/product';

let mainWindow: BrowserWindow | null = null;
let socket: SocketIOClient.Socket | null = null;
const configStore = new SecureConfigStore();
let palworldManager: PalworldServerManager | null = null;

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
      const config = await configStore.getPalDefenderConfig();
      if (!config.token) throw new Error('팰월드 서버 자동 설정을 먼저 완료해 주세요.');
      await palworldManager?.ensureStarted(config, (message) => sendEvent('log', { level: 'info', message }));
      const client = new PalDefenderClient(config);
      await client.getVersion();
      const players = await client.getPlayers();
      const selected = players.find((player) => /online|connected/i.test(player.Status ?? '')) ?? (players.length === 1 ? players[0] : undefined);
      if (selected) {
        await configStore.savePalDefenderConfig({ ...config, playerId: selected.UserId || selected.PlayerUID });
      }
      sendEvent('status', { palworld: 'connected' });
      return { ok: true, players };
    } catch (error) {
      const message = getSafeErrorMessage(error, 'PalDefender 연결에 실패했습니다.');
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
      if (!palworldManager) throw new Error('팰월드 서버 관리자를 시작하지 못했습니다.');
      sendEvent('status', { palworld: 'preparing' });
      const existing = await configStore.getPalDefenderConfig();
      if (existing.token && existing.serverDir) {
        await palworldManager.ensureStarted(existing, (message) => sendEvent('log', { level: 'info', message }));
        sendEvent('status', { palworld: 'connected' });
        return { ok: true, message: '설치된 팰월드 서버를 시작하고 연결했습니다.' };
      }
      const config = await palworldManager.prepare((message) => sendEvent('log', { level: 'info', message }));
      await configStore.savePalDefenderConfig(config);
      sendEvent('status', { palworld: 'connected' });
      return { ok: true, message: '팰월드 전용 서버 설치와 연결을 완료했습니다.' };
    } catch (error) {
      const message = getSafeErrorMessage(error, '팰월드 서버 자동 설정에 실패했습니다.');
      sendEvent('status', { palworld: 'error' });
      return { ok: false, message };
    }
  });
}

async function emitEffect(amount: string | number, source: string): Promise<{ ok: boolean; message?: string }> {
  const effect = resolveDonationEffect(amount);
  if (!effect) return { ok: false, message: '해당 금액에 등록된 효과가 없습니다.' };
  try {
    const config = await configStore.getPalDefenderConfig();
    if (!config.token) throw new Error('팰월드 서버 자동 설정을 먼저 완료해 주세요.');
    await palworldManager?.ensureStarted(config, (message) => sendEvent('log', { level: 'info', message }));
    const result = await executeDonationEffect(effect, config);
    const playerId = result.player.UserId || result.player.PlayerUID;
    if (playerId && playerId !== config.playerId) {
      await configStore.savePalDefenderConfig({ ...config, playerId });
    }
    sendEvent('effect', { ...effect, detail: result.detail, source, mode: 'live' });
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
  palworldManager = new PalworldServerManager(path.join(app.getPath('userData'), 'palworld'));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  socket?.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  palworldManager?.stop();
});
