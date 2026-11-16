#!/usr/bin/env node
/**
 * Dump the champion-select / gameflow payloads (ASCII output on purpose).
 *
 * Goal: find out what the CN client exposes while picking a champion, so we
 * can show every player's level + rank + avatar BEFORE the game starts.
 *
 * Run this while you are in champion select:
 *   node scripts\dump-lcu-champselect.mjs
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

/** Print every field of an object, one per line (truncated). */
function dumpObject(obj, indent = '  ') {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const rendered =
      typeof value === 'object' && value !== null ? JSON.stringify(value).slice(0, 400) : JSON.stringify(value);
    console.log(`${indent}${key} = ${rendered}`);
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
  const out = { champselect: null, gameflow: null, profiles: [] };

  // ===================== part 1: champion select =====================

  console.log('');
  console.log('===================== champion select =====================');

  const cs = await call('/lol-champ-select/v1/session');
  console.log(`/lol-champ-select/v1/session -> ${cs.status} ${cs.error || ''}`);
  if (cs.status === 200 && cs.text) {
    const csJson = parseJson(cs.text);
    if (csJson) {
      out.champselect = csJson;
      console.log(`session fields: ${fieldNames(csJson)}`);
      console.log(`localPlayerCellId = ${JSON.stringify(csJson.localPlayerCellId)}`);
      console.log(`timer = ${JSON.stringify(csJson.timer)}`);
      console.log(`queue = ${JSON.stringify(csJson.queue)}`);
      console.log(`gameflowPhase = ${JSON.stringify(csJson.gameflowPhase)}`);
      for (const team of ['myTeam', 'theirTeam']) {
        const members = Array.isArray(csJson[team]) ? csJson[team] : [];
        console.log('');
        console.log(`--- ${team} (${members.length}) ---`);
        if (members.length === 0) continue;
        console.log(`entry fields: ${fieldNames(members[0])}`);
        for (const member of members) {
          console.log(
            `  cellId=${member.cellId} puuid=${member.puuid} playerId=${member.playerId} ` +
              `summonerId=${member.summonerId} championId=${member.championId} ` +
              `pos=${member.assignedPosition} isMine=${member.isMine} teamId=${member.teamId}`
          );
        }
        console.log(`full first entry:`);
        dumpObject(members[0], '    ');
      }
    }
  }

  // ===================== part 2: gameflow =====================

  console.log('');
  console.log('===================== gameflow =====================');

  const gf = await call('/lol-gameflow/v1/session');
  console.log(`/lol-gameflow/v1/session -> ${gf.status} ${gf.error || ''}`);
  if (gf.status === 200 && gf.text) {
    const gfJson = parseJson(gf.text);
    if (gfJson) {
      out.gameflow = gfJson;
      console.log(`session fields: ${fieldNames(gfJson)}`);
      console.log(`phase = ${JSON.stringify(gfJson.phase)}`);
      const gameData = gfJson.gameData && typeof gfJson.gameData === 'object' ? gfJson.gameData : {};
      console.log(`gameData fields: ${fieldNames(gameData)}`);
      console.log(`queue = ${JSON.stringify(gameData.queue)}`);
      for (const team of ['teamOne', 'teamTwo']) {
        const members = Array.isArray(gameData[team]) ? gameData[team] : [];
        console.log('');
        console.log(`--- ${team} (${members.length}) ---`);
        if (members.length === 0) continue;
        console.log(`entry fields: ${fieldNames(members[0])}`);
        for (const member of members) {
          console.log(
            `  puuid=${member.puuid} summonerId=${member.summonerId} ` +
              `summonerName=${JSON.stringify(member.summonerName)} ` +
              `profileIconId=${member.profileIconId} championId=${member.championId} ` +
              `position=${member.selectedPosition} role=${member.selectedRole} teamOwner=${member.teamOwner}`
          );
        }
      }
    }
  }

  // ===================== part 3: profile lookups =====================

  console.log('');
  console.log('===================== profile lookups =====================');

  // Collect every id we can see, from both payloads.
  const ids = new Map();
  const addId = (kind, value) => {
    if (!value) return;
    const key = `${kind}:${value}`;
    if (!ids.has(key)) ids.set(key, { kind, value });
  };

  const csJson = out.champselect;
  if (csJson) {
    // Only my own team: the enemy identities are not available in champion
    // select and the UI must not try to show them.
    for (const member of csJson.myTeam || []) {
      addId('puuid', member.puuid);
      addId('summonerId', member.summonerId);
      addId('playerId', member.playerId);
    }
    const enemy = csJson.theirTeam || [];
    const enemyWithPuuid = enemy.filter((m) => m.puuid).length;
    const enemyWithPlayerId = enemy.filter((m) => m.playerId).length;
    console.log(`enemy entries: ${enemy.length}, with puuid: ${enemyWithPuuid}, with playerId: ${enemyWithPlayerId}`);
  }
  const gfJson = out.gameflow;
  if (gfJson && gfJson.gameData) {
    for (const team of ['teamOne', 'teamTwo']) {
      for (const member of (gfJson.gameData[team] || [])) {
        addId('puuid', member.puuid);
        addId('summonerId', member.summonerId);
      }
    }
  }

  console.log(`ids seen: ${ids.size}`);
  let index = 0;
  for (const { kind, value } of ids.values()) {
    index += 1;
    if (index > 6) {
      console.log('(stopping after 6 ids)');
      break;
    }
    console.log('');
    console.log(`##### ${kind} = ${value}`);
    const candidates = [];
    if (kind === 'puuid') {
      candidates.push(`/lol-summoner/v2/summoners/puuid/${value}`);
      candidates.push(`/lol-summoner/v1/summoners/by-puuid/${value}`);
      candidates.push(`/lol-ranked/v1/ranked-stats/by-puuid/${value}`);
    } else {
      candidates.push(`/lol-summoner/v1/summoners/${value}`);
      candidates.push(`/lol-summoner/v2/summoners/${value}`);
    }
    for (const candidate of candidates) {
      const r = await call(candidate);
      console.log(`  ${candidate} -> ${r.status} ${r.error || ''}`);
      if (r.status !== 200 || !r.text) continue;
      const obj = parseJson(r.text);
      if (!obj) continue;
      console.log(`    fields: ${fieldNames(obj)}`);
      for (const key of [
        'displayName',
        'gameName',
        'tagLine',
        'summonerName',
        'summonerLevel',
        'profileIconId',
        'summonerId',
        'puuid'
      ]) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          console.log(`    ${key} = ${JSON.stringify(obj[key])}`);
        }
      }
      if (obj.regalia) {
        console.log(`    regalia fields: ${fieldNames(obj.regalia)}`);
        console.log(`    regalia.highestRankedEntry = ${JSON.stringify(obj.regalia.highestRankedEntry)}`);
      }
      if (Array.isArray(obj.rankedQueues)) {
        console.log(`    rankedQueues(${obj.rankedQueues.length}):`);
        for (const queue of obj.rankedQueues) {
          console.log(
            `      queueType=${queue.queueType} tier=${queue.tier} division=${queue.division} ` +
              `wins=${queue.wins} losses=${queue.losses} lp=${queue.leaguePoints}`
          );
        }
      }
      out.profiles.push({ kind, value, path: candidate, obj });
    }
  }

  // ===================== part 4: save =====================

  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, 'champselect-dump.json');
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
