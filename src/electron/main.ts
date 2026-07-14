import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { authorizeWithLocalCallback, ChzzkAuthConfig } from '../chzzk/auth';
import { createChzzkSession } from '../chzzk/session';
import { connectDonationListener } from '../chzzk/donation-listener';
import { getSafeErrorMessage } from '../chzzk/api-error';
import { SecureConfigStore } from './secure-config';
import { PalDefenderClient, PalDefenderConfig } from '../palworld/paldefender-client';
import { resolveDonationEffect } from '../donation/effect-engine';

let mainWindow: BrowserWindow | null = null;
let socket: SocketIOClient.Socket | null = null;
const configStore = new SecureConfigStore();

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

  ipcMain.handle('config:save', async (event, input: ChzzkAuthConfig) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    const clientId = String(input?.clientId ?? '').trim();
    const clientSecret = String(input?.clientSecret ?? '').trim();
    const redirectUri = String(input?.redirectUri ?? '').trim();

    if (!clientId || !redirectUri) throw new Error('Client ID와 리디렉션 URL을 입력해 주세요.');
    const url = new URL(redirectUri);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('리디렉션 URL은 localhost HTTP 주소여야 합니다.');
    }

    await configStore.saveAuthConfig({ clientId, clientSecret, redirectUri });
    return configStore.getPublicConfig();
  });

  ipcMain.handle('chzzk:connect', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    socket?.disconnect();
    socket = null;

    try {
      sendEvent('status', { chzzk: 'authorizing' });
      const config = await configStore.getAuthConfig();
      const tokens = await authorizeWithLocalCallback(config, async (url) => {
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
          emitEffect(donation.payAmount ?? 0, '후원');
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

  ipcMain.handle('palworld:save', async (event, input: PalDefenderConfig) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    const baseUrl = String(input?.baseUrl ?? '').trim();
    const token = String(input?.token ?? '').trim();
    const playerId = String(input?.playerId ?? '').trim();
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('PalDefender API는 이 PC의 localhost 주소만 사용할 수 있습니다.');
    }
    await configStore.savePalDefenderConfig({ baseUrl, token, playerId, testMode: Boolean(input.testMode) });
    return configStore.getPublicConfig();
  });

  ipcMain.handle('palworld:test', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    try {
      const config = await configStore.getPalDefenderConfig();
      if (!config.token) throw new Error('PalDefender API 토큰을 입력해 주세요.');
      const client = new PalDefenderClient(config);
      await client.getVersion();
      const players = await client.getPlayers();
      sendEvent('status', { palworld: 'connected' });
      return { ok: true, players };
    } catch (error) {
      const message = getSafeErrorMessage(error, 'PalDefender 연결에 실패했습니다.');
      sendEvent('status', { palworld: 'error' });
      return { ok: false, message };
    }
  });

  ipcMain.handle('effect:test', (event, amount: number) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    return emitEffect(amount, '테스트');
  });
}

function emitEffect(amount: string | number, source: string): { ok: boolean; message?: string } {
  const effect = resolveDonationEffect(amount);
  if (!effect) return { ok: false, message: '해당 금액에 등록된 효과가 없습니다.' };
  sendEvent('effect', { ...effect, source, mode: 'test' });
  return { ok: true };
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
