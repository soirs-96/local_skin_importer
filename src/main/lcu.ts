import axios, { AxiosInstance } from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/** Credentials scraped from the League client lockfile. Never leaves the main process. */
export interface LcuAuth {
  port: number;
  token: string;
}

export interface CurrentSummoner {
  displayName: string;
  puuid: string;
}

/** Thrown when the lockfile is absent, i.e. the League client is not running. */
export class LcuNotRunningError extends Error {
  constructor(message = 'League client is not running (lockfile not found).') {
    super(message);
    this.name = 'LcuNotRunningError';
  }
}

/**
 * Lockfile lives in %LocalAppData%\Riot Games\League of Legends\lockfile.
 * `LOL_LOCKFILE_PATH` overrides it (used by tests and non-default installs).
 */
export function findLockfilePath(): string {
  const override = process.env.LOL_LOCKFILE_PATH;
  if (override) return override;

  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Riot Games', 'League of Legends', 'lockfile');
}

/**
 * Lockfile format is five colon-separated fields:
 *   LeagueClientUx:<pid>:<port>:<password>:<protocol>
 * The port is field 2 and the password is field 3 (both zero-indexed).
 */
export function parseLockfile(contents: string): LcuAuth {
  const fields = contents.trim().split(':');
  if (fields.length !== 5) {
    throw new Error(`Malformed lockfile: expected 5 colon-separated fields, got ${fields.length}.`);
  }

  const [, , portField, token] = fields;
  const port = Number(portField);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Malformed lockfile: invalid port "${portField}".`);
  }
  if (!token) {
    throw new Error('Malformed lockfile: empty token.');
  }

  return { port, token };
}

/** Reads and parses the lockfile. Throws {@link LcuNotRunningError} when it does not exist. */
export function readLockfile(lockfilePath: string = findLockfilePath()): LcuAuth {
  let raw: string;
  try {
    raw = fs.readFileSync(lockfilePath, 'utf8');
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      throw new LcuNotRunningError(
        `League client is not running (lockfile not found at ${lockfilePath}).`
      );
    }
    throw err;
  }
  return parseLockfile(raw);
}

/**
 * Reads the auth directly from the LeagueClientUx.exe process command line.
 * Used as a fallback because WeGame-installed LOL writes a lockfile that does not
 * track the current LOL PID (the lockfile is captured by the Riot Client launcher
 * at start, then never refreshed across LOL restarts).
 *
 * Two command-line shapes exist in the wild:
 *   1. Standard Riot install:
 *        --riotclient-app-port=<port>
 *        --riotclient-auth-token=<token>
 *   2. WeGame install (or any Tencent launcher that proxies LOL):
 *        --app-port=<port>
 *        --remoting-auth-token=<token>
 *
 * WeGame's LeagueClientUx.exe carries BOTH pairs. The LCU game API
 * (e.g. /lol-summoner/v1/current-summoner) is served on --app-port with
 * --remoting-auth-token; --riotclient-app-port serves the Riot Client API
 * (e.g. /rso-auth/v1/...) and returns 404 for game endpoints.
 *
 * Detection: if --remoting-auth-token is present, prefer the WeGame pair.
 * Otherwise fall back to the standard Riot pair.
 *
 * Uses Get-CimInstance via PowerShell because wmic was removed in Windows 11 24H2.
 * The script is piped via stdin (`-Command -`) to avoid cmd.exe quote-escaping pitfalls.
 */
export function readLcuAuthFromProcess(): LcuAuth {
  const psScript =
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
    "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | " +
    'Select-Object -ExpandProperty CommandLine';

  let out: string;
  try {
    out = execSync(`powershell.exe -NoProfile -NonInteractive -Command -`, {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      input: psScript
    });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'unknown';
    throw new LcuNotRunningError(
      `LeagueClientUx.exe not found (PowerShell query failed: ${detail}).`
    );
  }

  const remotingTokenMatch = out.match(/--remoting-auth-token=([\w-]+)/);
  const appPortMatch = out.match(/--app-port=(\d+)/);

  if (remotingTokenMatch && appPortMatch) {
    return { port: Number(appPortMatch[1]), token: remotingTokenMatch[1] };
  }

  const rcPortMatch = out.match(/--riotclient-app-port=(\d+)/);
  const rcTokenMatch = out.match(/--riotclient-auth-token=([\w-]+)/);

  if (rcPortMatch && rcTokenMatch) {
    return { port: Number(rcPortMatch[1]), token: rcTokenMatch[1] };
  }

  throw new LcuNotRunningError(
    'LeagueClientUx.exe is running but did not expose recognizable LCU port/token ' +
      '(expected --app-port + --remoting-auth-token, or --riotclient-app-port + --riotclient-auth-token).'
  );
}

/**
 * Resolves LCU auth. Prefers the process command line (works for both standard
 * Riot installs and WeGame). Falls back to the lockfile if wmic is unavailable
 * or the process is not running for the expected user.
 */
export function readLcuAuth(): LcuAuth {
  try {
    return readLcuAuthFromProcess();
  } catch {
    // fall through to lockfile
  }
  return readLockfile(findLockfilePath());
}

/**
 * Axios instance bound to the local LCU. Certificate verification is disabled because the
 * client serves a self-signed cert on 127.0.0.1 — this is scoped to this instance only.
 */
export function createLcuClient(port: number, token: string): AxiosInstance {
  const credentials = Buffer.from(`riot:${token}`, 'latin1').toString('base64');
  return axios.create({
    baseURL: `https://127.0.0.1:${port}`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 5000
  });
}

export async function getCurrentSummoner(client: AxiosInstance): Promise<CurrentSummoner> {
  const { data } = await client.get('/lol-summoner/v1/current-summoner');
  if (!isRecord(data)) {
    throw new Error('Unexpected /lol-summoner/v1/current-summoner response.');
  }
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    puuid: typeof data.puuid === 'string' ? data.puuid : ''
  };
}

/** Owned skin IDs for the local player.
 *
 * WeGame-installed LOL does not expose the standard Riot endpoint
 * `/lol-champions/v1/inventories/local-player/skin-minimal` (returns 404 with
 * "Invalid URI format"). The WeGame LCU fork exposes the same data through the
 * store catalog: `/lol-store/v1/skins` returns every champion and skin in the
 * game, each annotated with an `owned` flag and an `inventoryType` discriminator.
 * We keep only `CHAMPION_SKIN` entries with `owned === true` and return their
 * numeric `itemId` (which follows the `<championId>000+<skinIndex>` convention,
 * e.g. `161013` = champion 161 skin 13).
 */
export async function getOwnedSkinIds(client: AxiosInstance): Promise<number[]> {
  const { data } = await client.get('/lol-store/v1/skins');
  if (!Array.isArray(data)) return [];

  return data
    .filter((entry: unknown): entry is Record<string, unknown> => isOwnedSkin(entry))
    .map((entry) => Number(entry.itemId))
    .filter((id) => Number.isFinite(id));
}

function isOwnedSkin(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  return entry.inventoryType === 'CHAMPION_SKIN' && entry.owned === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
