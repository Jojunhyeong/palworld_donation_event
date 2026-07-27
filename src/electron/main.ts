import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { authorizeWithRemoteService } from '../cime/remote-auth';
import { createCimeSession } from '../cime/session';
import { CimeDonationConnection, connectDonationListener } from '../cime/donation-listener';
import { getSafeErrorMessage } from '../cime/api-error';
import { SecureConfigStore } from './secure-config';
import { PalworldClientModManager } from '../palworld/client-mod-manager';
import { executeClientDonationEffect } from '../palworld/client-effect-executor';
import { resolveDonationEffect } from '../donation/effect-engine';
import { AUTH_SERVICE_URL } from '../config/product';

let mainWindow: BrowserWindow | null = null;
let socket: CimeDonationConnection | null = null;
const configStore = new SecureConfigStore();
let palworldManager: PalworldClientModManager | null = null;

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

  ipcMain.handle('cime:connect', async (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    socket?.disconnect();
    socket = null;

    try {
      sendEvent('status', { cime: 'authorizing' });
      const tokens = await authorizeWithRemoteService(AUTH_SERVICE_URL, async (url) => {
        await shell.openExternal(url);
      });
      await configStore.saveTokens(tokens);

      sendEvent('status', { cime: 'connecting' });
      const sessionUrl = await createCimeSession(tokens.accessToken);
      socket = connectDonationListener(sessionUrl, tokens.accessToken, {
        onStatus: (status) => sendEvent('status', { cime: status }),
        onLog: (message) => sendEvent('log', { level: 'info', message }),
        onError: (message) => sendEvent('log', { level: 'error', message }),
        onDonation: (donation) => {
          sendEvent('donation', donation);
          void emitEffect(donation.payAmount ?? 0, '후원');
        },
      });
      return { ok: true };
    } catch (error) {
      const message = getSafeErrorMessage(error, '씨미 연결에 실패했습니다.');
      sendEvent('status', { cime: 'error' });
      sendEvent('log', { level: 'error', message });
      return { ok: false, message };
    }
  });

  ipcMain.handle('cime:disconnect', (event) => {
    assertTrustedSender(event.senderFrame?.url ?? '');
    socket?.disconnect();
    socket = null;
    sendEvent('status', { cime: 'disconnected' });
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

async function emitEffect(amount: string | number, source: string): Promise<{ ok: boolean; message?: string }> {
  const effect = resolveDonationEffect(amount);
  if (!effect) return { ok: false, message: '해당 금액에 등록된 효과가 없습니다.' };
  try {
    if (!palworldManager) throw new Error('팰월드 모드 관리자를 시작하지 못했습니다.');
    const config = await configStore.getClientModConfig();
    const detail = await executeClientDonationEffect(effect, palworldManager, config);
    sendEvent('effect', { ...effect, detail, source, mode: 'live' });
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
    title: '씨미 팰 후원 브리지',
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
