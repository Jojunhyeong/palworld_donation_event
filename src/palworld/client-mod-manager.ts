import axios from 'axios';
import { execFile } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import extract from 'extract-zip';
import { createReadStream, createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';

const execFileAsync = promisify(execFile);
const PALWORLD_APP_ID = '1623730';
const UE4SS_URL = 'https://github.com/Okaetsu/RE-UE4SS/releases/download/experimental-palworld/UE4SS-Palworld.zip';
const UE4SS_SHA256 = '768a45718fbb9e429ac5cc3ce4a139a1b7b468bff31b4a136ae483d725aca1ca';
const INSTALL_MARKER = '.pal-donation-ue4ss-version';
const MOD_NAME = 'PalDonationBridge';
// Increase this whenever the app-to-Lua command format changes. In particular,
// older scripts do not understand the player-name argument and silently apply
// effects to the host, so accepting an unversioned heartbeat is unsafe.
const MOD_PROTOCOL_VERSION = 'party-target-v2';

type ProgressHandler = (message: string) => void;

export interface ClientModConfig {
  gameWin64Dir: string;
}

export interface ClientModStatus {
  installed: boolean;
  gameRunning: boolean;
  compatible: boolean;
  gameWin64Dir: string;
}

export class PalworldClientModManager {
  private commandChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDir: string) {}

  get supported(): boolean {
    return process.platform === 'win32';
  }

  async prepare(onProgress: ProgressHandler): Promise<ClientModConfig> {
    if (!this.supported) throw new Error('일반 초대방 모드 자동 설치는 Windows에서 진행해 주세요.');

    onProgress('Steam에서 설치된 팰월드를 찾는 중입니다.');
    const gameWin64Dir = await findPalworldWin64Dir();
    const modRoot = this.getModRoot(gameWin64Dir);
    await fs.mkdir(this.rootDir, { recursive: true });

    const loaderDll = path.join(gameWin64Dir, 'dwmapi.dll');
    const ue4ssDll = path.join(gameWin64Dir, 'ue4ss', 'UE4SS.dll');
    const marker = path.join(gameWin64Dir, 'ue4ss', INSTALL_MARKER);
    const hasLoader = (await fileExists(loaderDll)) || (await fileExists(ue4ssDll));
    if (hasLoader && !(await fileExists(marker))) {
      throw new Error('기존 팰월드 모드 로더가 발견되었습니다. 충돌 방지를 위해 기존 UE4SS 또는 Workshop 모드를 먼저 해제해 주세요.');
    }

    const installedVersion = await readText(marker);
    if (installedVersion.trim() !== UE4SS_SHA256) {
      onProgress('일반 초대방용 모드 로더를 내려받는 중입니다.');
      const archive = path.join(this.rootDir, 'UE4SS-Palworld.zip');
      await downloadFile(UE4SS_URL, archive);
      await assertSha256(archive, UE4SS_SHA256);
      onProgress('검증된 모드 로더를 팰월드에 설치하는 중입니다.');
      await extract(archive, { dir: gameWin64Dir });
      await fs.writeFile(marker, UE4SS_SHA256, 'utf8');
    }

    await fs.mkdir(path.join(modRoot, 'Scripts'), { recursive: true });
    await fs.writeFile(path.join(modRoot, 'Scripts', 'main.lua'), createLuaMod(modRoot), 'utf8');
    await enableMod(gameWin64Dir);
    await clearBridgeFiles(modRoot);

    onProgress('방장용 후원 모드 설치가 완료됐습니다. 팰월드를 실행하고 멀티플레이 월드에 들어가 주세요.');
    return { gameWin64Dir };
  }

  async status(config: ClientModConfig): Promise<ClientModStatus> {
    const gameWin64Dir = config.gameWin64Dir || (this.supported ? await findPalworldWin64Dir() : '');
    if (!gameWin64Dir) return { installed: false, gameRunning: false, compatible: false, gameWin64Dir: '' };
    const modRoot = this.getModRoot(gameWin64Dir);
    const installed = await fileExists(path.join(modRoot, 'Scripts', 'main.lua'));
    const heartbeatPath = path.join(modRoot, 'heartbeat.txt');
    const heartbeat = await modifiedAt(heartbeatPath);
    const runtimeVersion = await readText(path.join(modRoot, 'runtime-version.txt'));
    return {
      installed,
      gameRunning: installed && Date.now() - heartbeat < 5_000,
      compatible: runtimeVersion.trim() === MOD_PROTOCOL_VERSION,
      gameWin64Dir,
    };
  }

  async giveItem(config: ClientModConfig, itemId: string, count: number, targetPlayerName?: string): Promise<void> {
    await this.sendCommand(config, 'give_item', itemId, String(count), ...optionalTarget(targetPlayerName));
  }

  async fullHeal(config: ClientModConfig, targetPlayerName?: string): Promise<void> {
    await this.sendCommand(config, 'full_heal', ...optionalTarget(targetPlayerName));
  }

  async superJump(config: ClientModConfig, targetPlayerName?: string): Promise<void> {
    await this.sendCommand(config, 'super_jump', ...optionalTarget(targetPlayerName));
  }

  async randomMove(config: ClientModConfig, targetPlayerName?: string): Promise<void> {
    await this.sendCommand(config, 'random_move', ...optionalTarget(targetPlayerName));
  }

  async deleteRandomItem(config: ClientModConfig, targetPlayerName?: string): Promise<void> {
    await this.sendCommand(config, 'delete_random_item', ...optionalTarget(targetPlayerName));
  }

  async killPlayer(config: ClientModConfig, targetPlayerName?: string): Promise<void> {
    await this.sendCommand(config, 'kill_player', ...optionalTarget(targetPlayerName));
  }

  async listPlayers(config: ClientModConfig): Promise<string[]> {
    const result = await this.sendCommand(config, 'list_players');
    return result === 'none' ? [] : result.split('\n').filter(Boolean);
  }

  private async sendCommand(config: ClientModConfig, command: string, ...args: string[]): Promise<string> {
    const operation = async (): Promise<string> => {
      const status = await this.status(config);
      if (!status.installed) throw new Error('일반 초대방 모드를 먼저 설치해 주세요.');
      if (!status.gameRunning) throw new Error('팰월드를 실행하고 멀티플레이 월드에 들어가 주세요.');
      if (!status.compatible) {
        throw new Error('설치된 방장 모드가 구버전입니다. 팰월드를 종료하고 방장 모드를 다시 설치한 뒤 재실행해 주세요.');
      }

      const modRoot = this.getModRoot(status.gameWin64Dir);
      const commandPath = path.join(modRoot, 'command.txt');
      const resultPath = path.join(modRoot, 'result.txt');
      const temporaryPath = path.join(modRoot, 'command.tmp');
      const id = randomUUID();
      await Promise.all([resultPath, commandPath, temporaryPath].map((filePath) => fs.rm(filePath, { force: true })));
      if ([command, ...args].some((field) => field.includes('|'))) throw new Error('잘못된 팰월드 명령입니다.');
      await fs.writeFile(temporaryPath, [id, command, ...args].join('|'), 'utf8');
      await fs.rename(temporaryPath, commandPath);

      const result = await waitForResult(resultPath, id, 10_000);
      if (!result.ok) throw new Error(`팰월드 모드가 효과를 실행하지 못했습니다: ${result.detail}`);
      return result.detail;
    };

    const queued = this.commandChain.then(operation, operation);
    this.commandChain = queued.catch(() => undefined);
    return queued;
  }

  private getModRoot(gameWin64Dir: string): string {
    return path.join(gameWin64Dir, 'ue4ss', 'Mods', MOD_NAME);
  }
}

function optionalTarget(targetPlayerName?: string): string[] {
  const target = targetPlayerName?.trim();
  return target ? [target] : [];
}

async function findPalworldWin64Dir(): Promise<string> {
  const steamRoots = new Set<string>();
  if (process.env['PROGRAMFILES(X86)']) steamRoots.add(path.join(process.env['PROGRAMFILES(X86)'], 'Steam'));
  if (process.env.PROGRAMFILES) steamRoots.add(path.join(process.env.PROGRAMFILES, 'Steam'));

  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true });
    const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match?.[1]) steamRoots.add(match[1].trim().replace(/\//g, path.sep));
  } catch {
    // 기본 설치 위치와 Steam 라이브러리 파일을 계속 확인합니다.
  }

  const libraries = new Set<string>();
  for (const root of steamRoots) {
    libraries.add(root);
    const vdf = await readText(path.join(root, 'steamapps', 'libraryfolders.vdf'));
    for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      libraries.add(match[1].replace(/\\\\/g, '\\'));
    }
  }

  for (const library of libraries) {
    const steamapps = path.join(library, 'steamapps');
    const manifest = await readText(path.join(steamapps, `appmanifest_${PALWORLD_APP_ID}.acf`));
    const installDir = manifest.match(/"installdir"\s+"([^"]+)"/i)?.[1] ?? 'Palworld';
    const win64 = path.join(steamapps, 'common', installDir, 'Pal', 'Binaries', 'Win64');
    if (await fileExists(path.join(win64, 'Palworld-Win64-Shipping.exe'))) return win64;
  }

  throw new Error('Steam에 설치된 팰월드를 찾지 못했습니다. Steam에서 팰월드를 한 번 실행한 뒤 다시 시도해 주세요.');
}

async function enableMod(gameWin64Dir: string): Promise<void> {
  const modsDir = path.join(gameWin64Dir, 'ue4ss', 'Mods');
  const jsonPath = path.join(modsDir, 'mods.json');
  let entries: Array<{ mod_name: string; mod_enabled: boolean }> = [];
  try {
    entries = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as Array<{ mod_name: string; mod_enabled: boolean }>;
  } catch {
    // 새 목록을 만듭니다.
  }
  const existing = entries.find((entry) => entry.mod_name === MOD_NAME);
  if (existing) existing.mod_enabled = true;
  else entries.push({ mod_name: MOD_NAME, mod_enabled: true });
  await fs.writeFile(jsonPath, JSON.stringify(entries, null, 2), 'utf8');

  const legacyPath = path.join(modsDir, 'mods.txt');
  const legacy = await readText(legacyPath);
  if (!new RegExp(`^${MOD_NAME}\\s*:`, 'm').test(legacy)) {
    await fs.writeFile(legacyPath, `${legacy.trimEnd()}\n${MOD_NAME} : 1\n`, 'utf8');
  }
}

async function clearBridgeFiles(modRoot: string): Promise<void> {
  await Promise.all(
    ['command.txt', 'command.tmp', 'result.txt', 'heartbeat.txt', 'runtime-version.txt'].map((name) =>
      fs.rm(path.join(modRoot, name), { force: true }),
    ),
  );
}

function createLuaMod(modRoot: string): string {
  const root = modRoot.replace(/\\/g, '/');
  return `local ROOT = [[${root}]]
local PROTOCOL_VERSION = [[${MOD_PROTOCOL_VERSION}]]
local COMMAND_PATH = ROOT .. "/command.txt"
local RESULT_PATH = ROOT .. "/result.txt"
local HEARTBEAT_PATH = ROOT .. "/heartbeat.txt"
local VERSION_PATH = ROOT .. "/runtime-version.txt"

local function write_file(file_path, contents)
    local file = io.open(file_path, "w")
    if file == nil then return false end
    file:write(contents)
    file:close()
    return true
end

write_file(VERSION_PATH, PROTOCOL_VERSION)

local function split(value)
    local fields = {}
    for field in string.gmatch(value, "([^|]+)") do
        table.insert(fields, field)
    end
    return fields
end

local function get_utility()
    local utility = StaticFindObject("/Script/Pal.Default__PalUtility")
    if utility == nil or not utility:IsValid() then error("utility_not_found") end
    return utility
end

local function get_player_name(player)
    local state = player:GetPalPlayerState()
    if state == nil or not state:IsValid() then return nil end
    return state:GetPlayerName()
end

local function find_target_player(target_name)
    if target_name == nil or target_name == "" then
        local utility = get_utility()
        local context = FindFirstOf("PalPlayerCharacter")
        if context == nil or not context:IsValid() then error("player_not_found") end
        local controller = utility:GetLocalPlayerController(context)
        if controller == nil or not controller:IsValid() then error("local_controller_not_found") end
        local player = controller:K2_GetPawn()
        if player == nil or not player:IsValid() then error("local_player_not_found") end
        return player
    end

    local players = FindAllOf("PalPlayerCharacter") or {}
    for _, player in pairs(players) do
        if player ~= nil and player:IsValid() and get_player_name(player) == target_name then return player end
    end
    error("target_player_not_found:" .. target_name)
end

local function list_player_names()
    local names = {}
    local seen = {}
    local players = FindAllOf("PalPlayerCharacter") or {}
    for _, player in pairs(players) do
        if player ~= nil and player:IsValid() then
            local name = get_player_name(player)
            if name ~= nil and name ~= "" and not seen[name] then
                seen[name] = true
                table.insert(names, name)
            end
        end
    end
    table.sort(names)
    return #names > 0 and table.concat(names, "\n") or "none"
end

local function get_player_inventory(player)
    local state = player:GetPalPlayerState()
    if state == nil or not state:IsValid() then error("player_state_not_found") end
    local inventory = state:GetInventoryData()
    if inventory == nil or not inventory:IsValid() then error("inventory_not_found") end
    return inventory
end

local function execute_command(fields)
    local id = fields[1] or "unknown"
    local command = fields[2]

    ExecuteInGameThread(function()
        local ok, result = pcall(function()
            if command == "list_players" then return list_player_names() end
            local target_name = command == "give_item" and fields[5] or fields[3]
            local player = find_target_player(target_name)
            if command == "give_item" then
                local item_id = fields[3]
                local count = tonumber(fields[4])
                if item_id == nil or count == nil or count < 1 or count > 9999 then error("invalid_item") end
                local inventory = get_player_inventory(player)
                inventory:AddItem_ServerInternal(FName(item_id), count, false, 0, true)
            elseif command == "full_heal" then
                local parameter = player:GetCharacterParameterComponent()
                if parameter == nil or not parameter:IsValid() then error("parameter_not_found") end
                parameter:AddHPByRate_ToServer(1.0)
            elseif command == "super_jump" then
                player:LaunchCharacter(FVector(0, 0, 1500), false, false)
            elseif command == "random_move" then
                local controller = player:GetPalPlayerController()
                if controller == nil or not controller:IsValid() then error("controller_not_found") end
                local location = player:K2_GetActorLocation()
                controller:Debug_Teleport2D(FVector(location.X + math.random(-5000, 5000), location.Y + math.random(-5000, 5000), location.Z))
            elseif command == "delete_random_item" then
                local utility = get_utility()
                local inventory = get_player_inventory(player)
                local container_manager = utility:GetItemContainerManager(player)
                if container_manager == nil or not container_manager:IsValid() then error("container_manager_not_found") end
                local container = container_manager:GetContainer(inventory.inventoryInfo.CommonContainerId)
                if container == nil or not container:IsValid() then error("common_container_not_found") end
                local candidates = {}
                for index = 0, container:Num() - 1 do
                    local slot = container:Get(index)
                    if slot ~= nil and slot:IsValid() and not slot:IsEmpty() then
                        local item_id = slot:GetItemId()
                        local count = slot:GetStackCount()
                        if count > 0 then table.insert(candidates, { id = item_id.StaticId, count = count }) end
                    end
                end
                if #candidates == 0 then error("inventory_empty") end
                local selected = candidates[math.random(#candidates)]
                local incident = StaticFindObject("/Script/Pal.Default__PalIncidentBase")
                if incident == nil or not incident:IsValid() then error("incident_utility_not_found") end
                local removed = incident:RequestConsumeInventoryItem(inventory, selected.id, selected.count)
                if removed == nil or removed < 1 then error("item_delete_failed") end
            elseif command == "kill_player" then
                local controller = player:GetPalPlayerController()
                if controller == nil or not controller:IsValid() then error("controller_not_found") end
                controller:SelfKillPlayer()
            else
                error("unsupported_command")
            end
            return "done"
        end)
        if ok then
            write_file(RESULT_PATH, id .. "|ok|" .. tostring(result or "done"))
        else
            write_file(RESULT_PATH, id .. "|error|" .. tostring(result))
        end
    end)
end

LoopAsync(250, function()
    write_file(HEARTBEAT_PATH, tostring(os.time()))
    local file = io.open(COMMAND_PATH, "r")
    if file ~= nil then
        local command = file:read("*a")
        file:close()
        os.remove(COMMAND_PATH)
        if command ~= nil and command ~= "" then execute_command(split(command)) end
    end
end)
`;
}

async function waitForResult(resultPath: string, id: string, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await readText(resultPath);
    const [resultId, status, ...detail] = value.split('|');
    if (resultId === id) return { ok: status === 'ok', detail: detail.join('|') || 'unknown' };
    await delay(100);
  }
  throw new Error('팰월드 모드의 응답이 없습니다. 게임 월드에 들어가 있는지 확인해 주세요.');
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const temporary = `${destination}.download`;
  const response = await axios.get<NodeJS.ReadableStream>(url, { responseType: 'stream', timeout: 60_000, maxRedirects: 5 });
  await pipeline(response.data, createWriteStream(temporary));
  await fs.rename(temporary, destination);
}

async function assertSha256(filePath: string, expected: string): Promise<void> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  if (hash.digest('hex') !== expected) throw new Error('팰월드 모드 로더의 무결성 검증에 실패했습니다.');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function modifiedAt(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
