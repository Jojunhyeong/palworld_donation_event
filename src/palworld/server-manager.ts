import axios from 'axios';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import extract from 'extract-zip';
import { createReadStream, createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PalDefenderClient, PalDefenderConfig } from './paldefender-client';

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const PALDEFENDER_VERSION = 'v1.8.3';
const PALDEFENDER_URL = `https://github.com/Ultimeit/PalDefender/releases/download/${PALDEFENDER_VERSION}/PalDefender.zip`;
const PALDEFENDER_SHA256 = '2ec395237018b18b91b6e25ed1338f9e203814a6a3fd5fec8408eba10bfb35c8';
const PALWORLD_APP_ID = '2394010';
const REST_PORT = 17993;
const RCON_PORT = 25575;
const DEFAULT_SERVER_NAME = 'Pal Donation Server';

export interface PalworldServerCredentials {
  baseUrl: string;
  token: string;
  playerId: string;
  testMode: boolean;
  rconPassword: string;
  rconPort: number;
  serverDir: string;
}

type ProgressHandler = (message: string) => void;

export class PalworldServerManager {
  private serverProcess: ChildProcessWithoutNullStreams | null = null;

  constructor(private readonly rootDir: string) {}

  get supported(): boolean {
    return process.platform === 'win32';
  }

  async prepare(onProgress: ProgressHandler): Promise<PalworldServerCredentials> {
    if (!this.supported) {
      throw new Error('팰월드 전용 서버 자동 설치는 Windows에서 실행할 수 있습니다.');
    }

    this.stop();

    const steamcmdDir = path.join(this.rootDir, 'steamcmd');
    const serverDir = path.join(this.rootDir, 'server');
    const downloadDir = path.join(this.rootDir, 'downloads');
    const steamcmdExe = path.join(steamcmdDir, 'steamcmd.exe');
    const serverExe = path.join(serverDir, 'PalServer.exe');
    const win64Dir = path.join(serverDir, 'Pal', 'Binaries', 'Win64');
    const palDefenderDir = path.join(win64Dir, 'PalDefender');
    const restConfigPath = path.join(palDefenderDir, 'RESTAPI', 'RESTConfig.json');

    await fs.mkdir(downloadDir, { recursive: true });
    await fs.mkdir(steamcmdDir, { recursive: true });
    await fs.mkdir(serverDir, { recursive: true });

    if (!(await fileExists(steamcmdExe))) {
      onProgress('SteamCMD를 내려받는 중입니다.');
      const steamZip = path.join(downloadDir, 'steamcmd.zip');
      await downloadFile(STEAMCMD_URL, steamZip);
      await extract(steamZip, { dir: steamcmdDir });
    }

    onProgress('팰월드 전용 서버를 설치하거나 업데이트하는 중입니다. 시간이 걸릴 수 있습니다.');
    await runSteamCmd(steamcmdExe, [
      '+force_install_dir', serverDir,
      '+login', 'anonymous',
      '+app_update', PALWORLD_APP_ID, 'validate',
      '+quit',
    ], onProgress);

    if (!(await fileExists(serverExe))) {
      throw new Error('팰월드 전용 서버 설치 파일을 찾지 못했습니다.');
    }

    await installPalDefender(downloadDir, win64Dir, onProgress);

    if (!(await fileExists(restConfigPath))) {
      onProgress('첫 실행으로 서버 설정 파일을 만드는 중입니다.');
      const bootstrap = this.spawnServer(serverExe, serverDir, onProgress);
      try {
        await waitForFile(restConfigPath, 90_000);
      } finally {
        await stopProcessTree(bootstrap);
      }
    }

    const token = randomBytes(48).toString('base64url');
    const rconPassword = randomBytes(30).toString('base64url');

    onProgress('로컬 전용 보안 설정을 적용하는 중입니다.');
    await configurePalworld(serverDir, rconPassword);
    await configurePalDefender(palDefenderDir, token);

    const config: PalworldServerCredentials = {
      baseUrl: `http://127.0.0.1:${REST_PORT}`,
      token,
      playerId: '',
      testMode: false,
      rconPassword,
      rconPort: RCON_PORT,
      serverDir,
    };

    onProgress('팰월드 서버를 시작하는 중입니다.');
    this.serverProcess = this.spawnServer(serverExe, serverDir, onProgress);
    await waitForPalDefender(config, 90_000);
    onProgress('팰월드 서버 준비가 완료됐습니다. 게임에서 서버에 접속해 주세요.');
    return config;
  }

  async ensureStarted(config: PalDefenderConfig, onProgress: ProgressHandler): Promise<void> {
    const client = new PalDefenderClient(config);
    try {
      await client.getVersion();
      return;
    } catch {
      // 로컬 API가 꺼져 있을 때만 앱이 설치한 서버를 시작합니다.
    }

    if (!this.supported || !config.serverDir) throw new Error('팰월드 서버 자동 설정을 먼저 완료해 주세요.');
    const serverExe = path.join(config.serverDir, 'PalServer.exe');
    if (!(await fileExists(serverExe))) throw new Error('설치된 팰월드 서버를 찾지 못했습니다.');
    onProgress('팰월드 서버를 시작하는 중입니다.');
    this.serverProcess = this.spawnServer(serverExe, config.serverDir, onProgress);
    await waitForPalDefender(config, 90_000);
  }

  async updateAndStart(config: PalDefenderConfig, onProgress: ProgressHandler): Promise<void> {
    if (!this.supported || !config.serverDir) throw new Error('팰월드 서버 자동 설정을 먼저 완료해 주세요.');
    const steamcmdDir = path.join(this.rootDir, 'steamcmd');
    const downloadDir = path.join(this.rootDir, 'downloads');
    const steamcmdExe = path.join(steamcmdDir, 'steamcmd.exe');
    const serverExe = path.join(config.serverDir, 'PalServer.exe');
    const win64Dir = path.join(config.serverDir, 'Pal', 'Binaries', 'Win64');
    if (!(await fileExists(steamcmdExe)) || !(await fileExists(serverExe))) {
      throw new Error('설치된 서버 파일을 찾지 못했습니다. 서버 자동 설정을 다시 진행해 주세요.');
    }

    await this.stopForUpdate(config, onProgress);
    onProgress('팰월드 전용 서버를 최신 버전으로 업데이트하는 중입니다.');
    await runSteamCmd(steamcmdExe, [
      '+force_install_dir', config.serverDir,
      '+login', 'anonymous',
      '+app_update', PALWORLD_APP_ID, 'validate',
      '+quit',
    ], onProgress);
    await installPalDefender(downloadDir, win64Dir, onProgress);
    onProgress('업데이트된 팰월드 서버를 시작하는 중입니다.');
    this.serverProcess = this.spawnServer(serverExe, config.serverDir, onProgress);
    await waitForPalDefender(config, 90_000);
    const info = await new PalDefenderClient(config).sendRcon('Info').catch(() => '버전 정보를 가져오지 못했습니다.');
    onProgress(`팰월드 서버 버전: ${String(info).trim().slice(0, 300)}`);
  }

  stop(): void {
    if (this.serverProcess && !this.serverProcess.killed) this.serverProcess.kill();
    this.serverProcess = null;
  }

  private async stopForUpdate(config: PalDefenderConfig, onProgress: ProgressHandler): Promise<void> {
    if (this.serverProcess && !this.serverProcess.killed) {
      const running = this.serverProcess;
      this.serverProcess = null;
      onProgress('업데이트를 위해 실행 중인 팰월드 서버를 종료합니다.');
      await stopProcessTree(running);
      await stopAllPalServerProcesses();
      await waitForPalDefenderDown(config, 20_000);
      return;
    }

    const client = new PalDefenderClient(config);
    try {
      await client.getVersion();
    } catch {
      await stopAllPalServerProcesses();
      return;
    }
    onProgress('업데이트를 위해 실행 중인 팰월드 서버를 종료합니다.');
    await client.sendRcon('Shutdown 1 Server_Update').catch(() => undefined);
    try {
      await waitForPalDefenderDown(config, 20_000);
    } catch {
      // 아래에서 남은 하위 프로세스까지 함께 종료합니다.
    }
    await stopAllPalServerProcesses();
    await waitForPalDefenderDown(config, 10_000);
  }

  private spawnServer(serverExe: string, serverDir: string, onProgress: ProgressHandler): ChildProcessWithoutNullStreams {
    const child = spawn(serverExe, ['-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS'], {
      cwd: serverDir,
      windowsHide: true,
      stdio: 'pipe',
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim();
      if (message) onProgress(`서버: ${message.slice(0, 300)}`);
    });
    return child;
  }
}

async function installPalDefender(downloadDir: string, win64Dir: string, onProgress: ProgressHandler): Promise<void> {
  onProgress(`PalDefender ${PALDEFENDER_VERSION}을 검증하고 설치하는 중입니다.`);
  const palDefenderZip = path.join(downloadDir, `PalDefender-${PALDEFENDER_VERSION}.zip`);
  await downloadFile(PALDEFENDER_URL, palDefenderZip);
  await assertSha256(palDefenderZip, PALDEFENDER_SHA256);
  await fs.mkdir(win64Dir, { recursive: true });
  await extract(palDefenderZip, { dir: win64Dir });
}

async function configurePalworld(serverDir: string, rconPassword: string): Promise<void> {
  const defaultPath = path.join(serverDir, 'DefaultPalWorldSettings.ini');
  const configDir = path.join(serverDir, 'Pal', 'Saved', 'Config', 'WindowsServer');
  const settingsPath = path.join(configDir, 'PalWorldSettings.ini');
  await fs.mkdir(configDir, { recursive: true });
  if (!(await fileExists(settingsPath))) await fs.copyFile(defaultPath, settingsPath);

  let settings = await fs.readFile(settingsPath, 'utf8');
  settings = replaceIniValue(settings, 'AdminPassword', `"${rconPassword}"`);
  settings = replaceIniValue(settings, 'RCONEnabled', 'True');
  settings = replaceIniValue(settings, 'RCONPort', String(RCON_PORT));
  settings = replaceIniValue(settings, 'ServerName', `"${DEFAULT_SERVER_NAME}"`);
  await fs.writeFile(settingsPath, settings, 'utf8');
}

export function replaceIniValue(settings: string, key: string, value: string): string {
  const expression = new RegExp(`(${escapeRegExp(key)}=)("[^"]*"|[^,\\r\\n)]*)`);
  if (!expression.test(settings)) throw new Error(`서버 설정에서 ${key} 항목을 찾지 못했습니다.`);
  return settings.replace(expression, `$1${value}`);
}

async function configurePalDefender(palDefenderDir: string, token: string): Promise<void> {
  const restDir = path.join(palDefenderDir, 'RESTAPI');
  const restConfigPath = path.join(restDir, 'RESTConfig.json');
  const tokensDir = path.join(restDir, 'Tokens');
  const restConfig = JSON.parse(await fs.readFile(restConfigPath, 'utf8')) as Record<string, unknown>;
  restConfig.Enabled = true;
  restConfig.Port = REST_PORT;
  await fs.mkdir(tokensDir, { recursive: true });
  await fs.writeFile(restConfigPath, JSON.stringify(restConfig, null, 2), 'utf8');
  await fs.writeFile(path.join(tokensDir, 'PalDonationBridge.json'), JSON.stringify({
    Name: 'PalDonationBridge',
    Token: token,
    Permissions: ['REST.Version.Read', 'REST.Players.Read', 'REST.Items.Give'],
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const temporary = `${destination}.download`;
  const response = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: 'stream',
    timeout: 60_000,
    maxRedirects: 5,
  });
  await pipeline(response.data, createWriteStream(temporary));
  await fs.rename(temporary, destination);
}

async function assertSha256(filePath: string, expected: string): Promise<void> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  const actual = hash.digest('hex');
  if (actual !== expected) throw new Error('PalDefender 파일 무결성 검증에 실패했습니다.');
}

async function runSteamCmd(command: string, args: string[], onProgress: ProgressHandler): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await runProcessDetailed(command, args, [0, 7]);
    if (result.exitCode === 0) {
      if (!result.tail.includes(`Success! App '${PALWORLD_APP_ID}' fully installed.`)) {
        throw new Error(`SteamCMD가 서버 설치 완료를 확인하지 못했습니다. ${result.tail}`);
      }
      return;
    }

    onProgress('SteamCMD 자체 업데이트가 완료되어 재시작을 기다리는 중입니다.');
    await waitForWindowsProcessExit('steamcmd.exe', 30 * 60_000);
    await delay(2_000);
    onProgress(`SteamCMD를 다시 실행합니다. (${attempt}/3)`);
  }
  throw new Error('SteamCMD 자체 업데이트 후 서버 설치를 다시 시작하지 못했습니다.');
}

async function runProcess(command: string, args: string[], acceptedExitCodes: number[] = [0]): Promise<number> {
  return (await runProcessDetailed(command, args, acceptedExitCodes)).exitCode;
}

async function runProcessDetailed(
  command: string,
  args: string[],
  acceptedExitCodes: number[] = [0],
): Promise<{ exitCode: number; tail: string }> {
  return new Promise<{ exitCode: number; tail: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'pipe' });
    let tail = '';
    child.stdout.on('data', (chunk: Buffer) => { tail = `${tail}${chunk.toString('utf8')}`.slice(-2_000); });
    child.stderr.on('data', (chunk: Buffer) => { tail = `${tail}${chunk.toString('utf8')}`.slice(-2_000); });
    child.on('error', reject);
    child.on('exit', (code) => {
      const exitCode = code ?? -1;
      if (acceptedExitCodes.includes(exitCode)) resolve({ exitCode, tail });
      else reject(new Error(`설치 프로그램이 종료 코드 ${exitCode}로 실패했습니다. ${tail}`));
    });
  });
}

async function stopAllPalServerProcesses(): Promise<void> {
  const images = ['PalServer.exe', 'PalServer-Win64-Shipping-Cmd.exe', 'PalServer-Win64-Shipping.exe'];
  for (const image of images) {
    await runProcess('taskkill.exe', ['/IM', image, '/T', '/F']).catch(() => undefined);
  }
  for (const image of images) {
    await waitForWindowsProcessExit(image, 15_000);
  }
  await delay(1_000);
}

async function waitForWindowsProcessExit(imageName: string, timeoutMs: number): Promise<void> {
  if (process.platform !== 'win32') return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = await captureProcessOutput('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/NH']);
    if (!output.toLowerCase().includes(imageName.toLowerCase())) return;
    await delay(2_000);
  }
  throw new Error('SteamCMD 재시작 완료 대기 시간이 초과됐습니다.');
}

async function captureProcessOutput(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', () => resolve(output));
  });
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(filePath)) return;
    await delay(1_000);
  }
  throw new Error('서버 설정 파일 생성 시간이 초과됐습니다.');
}

async function waitForPalDefender(config: PalDefenderConfig, timeoutMs: number): Promise<void> {
  const client = new PalDefenderClient(config);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.getVersion();
      return;
    } catch {
      await delay(2_000);
    }
  }
  throw new Error('팰월드 서버 연결 대기 시간이 초과됐습니다.');
}

async function waitForPalDefenderDown(config: PalDefenderConfig, timeoutMs: number): Promise<void> {
  const client = new PalDefenderClient(config);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.getVersion();
      await delay(1_000);
    } catch {
      return;
    }
  }
  throw new Error('실행 중인 팰월드 서버가 종료되지 않았습니다.');
}

async function stopProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.killed || child.exitCode !== null) return;
  if (process.platform !== 'win32' || !child.pid) {
    child.kill();
    return;
  }
  await runProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => child.kill());
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
