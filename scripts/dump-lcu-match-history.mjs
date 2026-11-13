#!/usr/bin/env node
/**
 * Dump raw LCU payloads (ASCII output on purpose).
 *
 * Why Node and not PowerShell: the CN client's LCU is a self-signed HTTPS
 * server that rejects Windows PowerShell 5.1's .NET TLS handshake
 * ("underlying connection was closed"). Node's https module with
 * rejectUnauthorized:false just works.
 *
 * Run with the game client open:
 *   node scripts\dump-lcu-match-history.mjs
 */

import { execFile } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

/** 客户端进程的命令行 —— 端口和 token 都在里面。 */
async function readClientCmdline() {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe' OR Name='LeagueClient.exe'\" " +
    '| ForEach-Object { $_.CommandLine }';
  return run('powershell.exe', ['-NoProfile', '-Command', script]);
}

function arg(cmdline, name) {
  const match = cmdline.match(new RegExp(`--${name}=([^"\\s]+)`));
  return match ? match[1] : '';
}

/** 从 lockfile 再取一次(万一命令行被截断)。 */
async function readLockfile() {
  const script =
    "Get-ChildItem -Path 'E:\\WeGameApps','C:\\Riot Games','D:\\WeGameApps' -Filter 'lockfile' " +
    '-Recurse -Depth 5 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName';
  return run('powershell.exe', ['-NoProfile', '-Command', script]);
}

function request(base, port, path, auth) {
  return new Promise((resolve) => {
    const client = base === 'https' ? https : http;
    const req = client.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        rejectUnauthorized: false,
        // The client server is happier with TLS 1.2 than with Node's default
        // TLS 1.3 offer - pin it so the handshake does not fall apart.
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            buffer,
            text: buffer.toString('utf8'),
            type: res.headers['content-type'] || ''
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, buffer: Buffer.alloc(0), text: '', type: '', error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ status: 0, buffer: Buffer.alloc(0), text: '', type: '', error: err.message });
    });
    req.end();
  });
}

function fieldNames(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.keys(obj).join(', ');
}

function pick(obj, path) {
  let current = obj;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function pickStr(obj, paths) {
  for (const path of paths) {
    const value = pick(obj, path);
    if (typeof value === 'string' && value !== '') return value;
  }
  return '';
}

function pickNum(obj, paths) {
  for (const path of paths) {
    const value = pick(obj, path);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  }
  return 0;
}

async function main() {
  console.log('===================== credentials =====================');

  const cmdline = await readClientCmdline();
  if (!cmdline.trim()) {
    console.log('Could not read the client command line. Is the game client running?');
    return;
  }

  const appPort = arg(cmdline, 'app-port');
  const riotPort = arg(cmdline, 'riotclient-app-port');
  const remotingToken = arg(cmdline, 'remoting-auth-token');
  const riotToken = arg(cmdline, 'riotclient-auth-token');
  console.log(`app-port=${appPort} riotclient-app-port=${riotPort}`);
  console.log(`remoting token length=${remotingToken.length} riot token length=${riotToken.length}`);

  const lockfile = await readLockfile();
  if (lockfile.trim()) {
    console.log(`lockfile: ${lockfile.trim()}`);
    try {
      const fields = (await run('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Get-Content -Raw -LiteralPath '${lockfile.trim()}'`
      ]))
        .trim()
        .split(':');
      if (fields.length >= 5) console.log(`lockfile port=${fields[2]} protocol=${fields[4]}`);
    } catch {
      /* lockfile is optional */
    }
  } else {
    console.log('lockfile: not found');
  }

  const attempts = [];
  if (appPort && remotingToken) attempts.push({ port: appPort, token: remotingToken, source: 'cmdline' });
  if (riotPort && riotToken) attempts.push({ port: riotPort, token: riotToken, source: 'riotclient' });

  let base = null;
  let auth = null;
  let usePort = 0;
  for (const attempt of attempts) {
    for (const proto of ['https', 'http']) {
      const candidateAuth = Buffer.from(`riot:${attempt.token}`, 'ascii').toString('base64');
      const res = await request(proto, attempt.port, '/lol-summoner/v1/current-summoner', candidateAuth);
      console.log(
        `try ${proto}://127.0.0.1:${attempt.port} (${attempt.source}) -> ${res.status} ${res.error || ''} ${res.type}`
      );
      if (res.status === 200) {
        base = proto;
        auth = candidateAuth;
        usePort = attempt.port;
        break;
      }
    }
    if (base) break;
  }

  if (!base) {
    console.log('No candidate endpoint answered 200.');
    return;
  }

  console.log(`using ${base}://127.0.0.1:${usePort}`);

  const call = async (path) => request(base, usePort, path, auth);

  // ===================== part 1: recent matches =====================

  console.log('');
  console.log('===================== match-history =====================');

  const res = await call('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=3');
  if (res.status !== 200) {
    console.log(`request failed, status ${res.status} ${res.error || ''}`);
  } else {
    let games = [];
    let payload = null;
    try {
      payload = JSON.parse(res.text);
    } catch (err) {
      console.log(`payload is not JSON: ${err.message}`);
      console.log(res.text.slice(0, 1200));
    }
    if (payload && Array.isArray(payload)) {
      games = payload;
    } else if (payload && payload.games) {
      const bucket = payload.games;
      if (Array.isArray(bucket)) games = bucket;
      else if (Array.isArray(bucket.games)) games = bucket.games;
      else if (typeof bucket === 'object') games = Object.values(bucket);
    }

    if (!games.length) {
      console.log('no games parsed, raw head:');
      console.log(res.text.slice(0, 1200));
    } else {
      for (const game of games) {
        console.log('--------------------------------------------------');
        console.log(`top level fields: ${fieldNames(game)}`);
        for (const key of ['gameId', 'gameMode', 'gameType', 'queueType', 'queueId', 'mapId', 'map', 'mode', 'tags']) {
          if (game && Object.prototype.hasOwnProperty.call(game, key)) {
            console.log(`  ${key} = ${JSON.stringify(game[key])}`);
          }
        }
        if (game.gameMetadata) {
          console.log(`  gameMetadata fields: ${fieldNames(game.gameMetadata)}`);
          for (const key of ['gameMode', 'queueId', 'mapId', 'queueType']) {
            if (Object.prototype.hasOwnProperty.call(game.gameMetadata, key)) {
              console.log(`    gameMetadata.${key} = ${JSON.stringify(game.gameMetadata[key])}`);
            }
          }
        }
        const participants = Array.isArray(game.participants) ? game.participants : [];
        if (participants.length) {
          console.log(`participant fields: ${fieldNames(participants[0])}`);
          const timeline = participants[0].timeline;
          if (timeline) {
            console.log(`  timeline fields: ${fieldNames(timeline)}`);
            console.log(`  timeline.lane = ${JSON.stringify(timeline.lane)}`);
            console.log(`  timeline.role = ${JSON.stringify(timeline.role)}`);
          }
        }
        console.log(
          `  picked -> gameMode=${pickStr(game, ['gameMode', 'gameMetadata.gameMode'])} ` +
            `mapId=${pickNum(game, ['mapId', 'gameMetadata.mapId'])} ` +
            `queueId=${pickNum(game, ['queueId', 'gameMetadata.queueId'])} ` +
            `queueType=${pickStr(game, ['queueType', 'gameMetadata.queueType'])}`
        );
      }
    }
  }

  // ===================== part 2: summoner avatar =====================

  console.log('');
  console.log('===================== profile / avatar =====================');

  const me = await call('/lol-summoner/v1/current-summoner');
  let puuid = '';
  if (me.status === 200 && me.text) {
    try {
      const meJson = JSON.parse(me.text);
      puuid = String(meJson.puuid || '');
      console.log(`current summoner puuid = ${puuid} (summonerId = ${meJson.summonerId})`);
      console.log(`current-summoner fields: ${fieldNames(meJson)}`);
    } catch (err) {
      console.log(`current-summoner body is not JSON: ${err.message}`);
    }
  } else {
    console.log(`current-summoner unavailable, status ${me.status} ${me.error || ''}`);
  }

  if (!puuid) {
    console.log('no puuid, skipping profile probes');
    return;
  }

  let iconId = null;
  for (const path of [
    `/lol-profile/v1/profiles/${puuid}`,
    `/lol-summoner/v1/summoners/${puuid}`,
    `/lol-summoner/v2/summoners/by-puuid/${puuid}`
  ]) {
    const r = await call(path);
    console.log('');
    console.log(`${path} -> ${r.status} ${r.error || ''}`);
    if (r.status === 200 && r.text) {
      let obj = null;
      try {
        obj = JSON.parse(r.text);
      } catch (err) {
        console.log(`  body is not JSON: ${err.message}`);
      }
      if (!obj) continue;
      console.log(`  fields: ${fieldNames(obj)}`);
      for (const key of ['profileIconId', 'summonerLevel', 'displayName', 'gameName', 'tagLine', 'backgroundSkinId']) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          console.log(`  ${key} = ${JSON.stringify(obj[key])}`);
        }
      }
      if (iconId === null && Object.prototype.hasOwnProperty.call(obj, 'profileIconId')) {
        iconId = obj.profileIconId;
      }
    }
  }

  const id = iconId === null ? 1 : iconId;
  console.log('');
  console.log(`probing avatar image resources (profileIconId = ${id}):`);
  for (const tpl of [
    '/lol-game-data/assets/v1/profile-icons/{id}.png',
    '/lol-game-data/assets/v1/profile-icons/{id}.jpg',
    '/lol-static-data/v1/profile-icons/{id}.png',
    '/lol-game-data/assets/v1/profile-icon/{id}.png',
    '/lol-game-data/assets/v1/profile/{id}.png',
    '/lol-game-data/assets/v1/profile-icons/{id}.webp'
  ]) {
    const path = tpl.replace('{id}', String(id));
    const r = await call(path);
    console.log(`  ${path} -> ${r.status} (${r.buffer.length} bytes) ${r.type} ${r.error || ''}`);
  }
}

main().catch((err) => {
  console.log(`fatal: ${err && err.message ? err.message : String(err)}`);
});
