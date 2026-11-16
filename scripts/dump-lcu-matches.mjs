#!/usr/bin/env node
/**
 * Dump the raw match-history payloads (ASCII output on purpose).
 *
 * Goal: find out how the CN client labels a ranked queue, so the mode text
 * next to a match is right. The screen currently guesses from `queueId`,
 * and one flex game came out as "单双排".
 *
 * Run this while the game client is open:
 *   node scripts\dump-lcu-matches.mjs
 */

import { execFile } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

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

function request(base, port, reqPath, auth) {
  return new Promise((resolve) => {
    const client = base === 'https' ? https : http;
    const req = client.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method: 'GET',
        rejectUnauthorized: false,
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

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  console.log('===================== credentials =====================');

  const cmdline = await readClientCmdline();
  if (!cmdline.trim()) {
    console.log('Could not read the client command line. Is the game client running?');
    return;
  }

  const appPort = arg(cmdline, 'app-port');
  const remotingToken = arg(cmdline, 'remoting-auth-token');
  console.log(`app-port=${appPort} token length=${remotingToken.length}`);

  let base = null;
  let auth = null;
  let usePort = 0;
  for (const proto of ['https', 'http']) {
    const candidateAuth = Buffer.from(`riot:${remotingToken}`, 'ascii').toString('base64');
    const res = await request(proto, appPort, '/lol-summoner/v1/current-summoner', candidateAuth);
    console.log(`try ${proto}://127.0.0.1:${appPort} -> ${res.status} ${res.error || ''}`);
    if (res.status === 200) {
      base = proto;
      auth = candidateAuth;
      usePort = appPort;
      break;
    }
  }
  if (!base) {
    console.log('No candidate endpoint answered 200.');
    return;
  }
  console.log(`using ${base}://127.0.0.1:${usePort}`);

  const call = async (reqPath) => request(base, usePort, reqPath, auth);

  console.log('');
  console.log('===================== match history =====================');

  const res = await call(
    '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19'
  );
  console.log(`match-history -> ${res.status} ${res.error || ''}`);
  if (res.status !== 200 || !res.text) {
    console.log('no payload');
    return;
  }

  const payload = parseJson(res.text);
  if (!payload) {
    console.log('payload is not JSON');
    return;
  }

  let games = [];
  if (Array.isArray(payload)) games = payload;
  else if (Array.isArray(payload.games)) games = payload.games;
  else if (payload.games && Array.isArray(payload.games.games)) games = payload.games.games;
  else if (payload.games && typeof payload.games === 'object') {
    games = Object.values(payload.games).filter((g) => g && typeof g === 'object');
  }

  console.log(`games: ${games.length}`);

  const out = [];
  for (const game of games) {
    if (!game || typeof game !== 'object') continue;
    const meta = game.gameMetadata && typeof game.gameMetadata === 'object' ? game.gameMetadata : {};
    const created = Number(game.gameCreation || 0);
    // 本地时间 —— 跟界面上「11月15日 22:58」对得上。
    const when = created
      ? new Date(created).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
      : '';
    console.log('');
    console.log(
      `gameId=${game.gameId} when=${when} ` +
        `queueId=${game.queueId ?? meta.queueId} queueType=${JSON.stringify(
          game.queueType ?? meta.queueType
        )} mapId=${game.mapId ?? meta.mapId} gameMode=${JSON.stringify(
          game.gameMode ?? meta.gameMode
        )} ranked=${JSON.stringify(game.ranked ?? meta.ranked)}`
    );
    console.log(`  top-level fields: ${fieldNames(game)}`);
    if (Object.keys(meta).length > 0) {
      console.log(`  gameMetadata fields: ${fieldNames(meta)}`);
      for (const [key, value] of Object.entries(meta)) {
        console.log(`    meta.${key} = ${JSON.stringify(value).slice(0, 300)}`);
      }
    }
    if (Array.isArray(game.tags)) console.log(`  tags = ${JSON.stringify(game.tags)}`);
    out.push(game);
  }

  // 最后按队列号汇总一遍 —— 同一个号对应哪个队列串,一眼能看出来。
  const byQueue = new Map();
  for (const game of games) {
    if (!game || typeof game !== 'object') continue;
    const meta = game.gameMetadata && typeof game.gameMetadata === 'object' ? game.gameMetadata : {};
    const key = `${game.queueId ?? meta.queueId ?? 0} / ${game.queueType ?? meta.queueType ?? '(无)'}`;
    byQueue.set(key, (byQueue.get(key) || 0) + 1);
  }
  console.log('');
  console.log('===================== queueId / queueType =====================');
  for (const [key, count] of byQueue.entries()) {
    console.log(`  ${key}  x${count}`);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, 'matches-dump.json');
  try {
    await fs.writeFile(target, JSON.stringify(out, null, 2), 'utf8');
    console.log('');
    console.log(`saved: ${target}`);
  } catch (err) {
    console.log(`could not save dump: ${err.message}`);
  }
}

main().catch((err) => {
  console.log(`fatal: ${err && err.message ? err.message : String(err)}`);
});
