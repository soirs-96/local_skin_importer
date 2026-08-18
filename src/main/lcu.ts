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
 * WeGame always passes:
 *   --riotclient-app-port=<port>
 *   --riotclient-auth-token=<token>
 * regardless of whether it also writes a lockfile.
 *
 * Uses Get-CimInstance via PowerShell because wmic was removed in Windows 11 24H2.
 */
export function readLcuAuthFromProcess(): LcuAuth {
  const psScript =
    "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | " +
    'Select-Object -ExpandProperty CommandLine';

  let out: string;
  try {
    out = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`,
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
  } catch {
    throw new LcuNotRunningError('LeagueClientUx.exe not found (PowerShell query failed).');
  }

  const portMatch = out.match(/--riotclient-app-port=(\d+)/);
  const tokenMatch = out.match(/--riotclient-auth-token=([\w-]+)/);

  if (!portMatch) {
    throw new LcuNotRunningError(
      'LeagueClientUx.exe is running but did not expose --riotclient-app-port.'
    );
  }
  if (!tokenMatch) {
    throw new LcuNotRunningError(
      'LeagueClientUx.exe is running but did not expose --riotclient-auth-token.'
    );
  }

  return { port: Number(portMatch[1]), token: tokenMatch[1] };
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

/** Owned skin IDs for the local player, filtered to entries the summoner actually owns. */
export async function getOwnedSkinIds(client: AxiosInstance): Promise<number[]> {
  const { data } = await client.get('/lol-champions/v1/inventories/local-player/skin-minimal');
  if (!Array.isArray(data)) return [];

  return data
    .filter((entry: unknown): entry is Record<string, unknown> => isOwned(entry))
    .map((entry) => Number(entry.id))
    .filter((id) => Number.isFinite(id));
}

function isOwned(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const { ownership } = entry;
  return isRecord(ownership) && ownership.owned === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
