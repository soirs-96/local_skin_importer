#!/usr/bin/env node
/**
 * Probe every candidate source for "which skin did I use this game".
 *
 * The four fallbacks in src/main/match/usedSkin.ts were written from guesses and
 * never probed against the CN client. This dumps the raw payloads of all of them
 * so we can see what the client actually gives us.
 *
 * Run with the game client open. Best moment: right after a game ends (the
 * post-game screen is up) - gameflow still holds the teams then. Second best:
 * during champion select.
 *   node scripts\probe-lcu-skin.mjs
 *
 * ASCII output on purpose: PowerShell 5.1 cannot do the TLS handshake with the
 * CN client's self-signed LCU, but Node can. Also the Windows console decodes
 * stdout as GBK, so Chinese would come out as mojibake.
 *
 * Everything interesting is ALSO written to disk as JSON (scripts\lcu-dump\) so
 * it can be inspected offline without re-running the probe.
 */

import { execFile } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DUMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lcu-dump');

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
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        headers: auth ? { Authorization: `Basic ${auth}` } : {},
        timeout: 15000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status: res.statusCode, text: buffer.toString('utf8'), bytes: buffer.length });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, text: '', bytes: 0, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ status: 0, text: '', bytes: 0, error: err.message });
    });
    req.end();
  });
}

function fieldNames(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.keys(obj).join(', ');
}

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Array or dict -> array of values. Dict shape is what the CN client ships. */
function toEntries(payload) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload)) return Object.values(payload).filter(isRecord);
  return [];
}

/** 同上,但保留字典的键(键就是英雄编号,条目里可能没有 id 字段)。 */
function toKeyedEntries(payload) {
  if (Array.isArray(payload)) return payload.filter(isRecord).map((e) => ({ key: '', entry: e }));
  if (isRecord(payload)) {
    return Object.entries(payload)
      .filter(([, e]) => isRecord(e))
      .map(([key, e]) => ({ key, entry: e }));
  }
  return [];
}

async function dump(name, text) {
  if (!text) return;
  try {
    await fs.mkdir(DUMP_DIR, { recursive: true });
    await fs.writeFile(path.join(DUMP_DIR, name), text, 'utf8');
  } catch {
    /* dump is best effort */
  }
}

async function main() {
  const cmdline = await readClientCmdline();
  if (!cmdline.trim()) {
    console.log('Could not read the client command line. Is the game client running?');
    return;
  }

  const attempts = [];
  const appPort = arg(cmdline, 'app-port');
  const remotingToken = arg(cmdline, 'remoting-auth-token');
  if (appPort && remotingToken) attempts.push({ port: appPort, token: remotingToken, source: 'cmdline' });

  let base = null;
  let auth = null;
  let usePort = 0;
  for (const attempt of attempts) {
    for (const proto of ['https', 'http']) {
      const candidateAuth = Buffer.from(`riot:${attempt.token}`, 'ascii').toString('base64');
      const res = await request(proto, attempt.port, '/lol-summoner/v1/current-summoner', candidateAuth);
      console.log(`try ${proto}://127.0.0.1:${attempt.port} -> ${res.status} ${res.error || ''}`);
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
  console.log(`using ${base}://127.0.0.1:${usePort}\n`);

  const call = async (p) => request(base, usePort, p, auth);

  const me = await call('/lol-summoner/v1/current-summoner');
  let puuid = '';
  if (me.status === 200) {
    try {
      const j = JSON.parse(me.text);
      puuid = String(j.puuid || '');
      console.log(`current-summoner: puuid=${puuid} summonerId=${j.summonerId} displayName=${j.displayName}`);
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- 1. gameflow
  console.log('\n===== 1. gameflow (/lol-gameflow/v1/session) =====');
  const gf = await call('/lol-gameflow/v1/session');
  console.log(`status=${gf.status} ${gf.error || ''}`);
  if (gf.status === 200) {
    await dump('gameflow-session.json', gf.text);
    try {
      const j = JSON.parse(gf.text);
      console.log(`top fields: ${fieldNames(j)}`);
      console.log(`phase=${j.phase}`);
      const gd = isRecord(j.gameData) ? j.gameData : {};
      console.log(`gameData fields: ${fieldNames(gd)}`);
      for (const key of ['teamOne', 'teamTwo']) {
        const team = gd[key];
        if (!Array.isArray(team)) {
          console.log(`  ${key}: not an array (${typeof team})`);
          continue;
        }
        console.log(`  ${key}: ${team.length} entries`);
        team.forEach((e, i) => {
          if (!isRecord(e)) return;
          console.log(
            `    [${i}] fields: ${fieldNames(e)}\n` +
              `        championId=${e.championId} skinId=${e.skinId} ` +
              `lastSelectedSkinIndex=${e.lastSelectedSkinIndex} ` +
              `selectedSkinIndex=${e.selectedSkinIndex} skinIndex=${e.skinIndex} ` +
              `selectedSkinId=${e.selectedSkinId} ` +
              `teamOwner=${e.teamOwner} ` +
              `puuid=${String(e.puuid || '').slice(0, 12)} name=${e.summonerName || e.riotIdGameName || ''}`
          );
          if (e.teamOwner === true) {
            console.log(`        >>> SELF ENTRY RAW: ${JSON.stringify(e)}`);
          }
        });
      }
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }

  // ------------------------------------------------------------ 2. champ select
  console.log('\n===== 2. champ select (/lol-champ-select/v1/session) =====');
  const cs = await call('/lol-champ-select/v1/session');
  console.log(`status=${cs.status} ${cs.error || ''}`);
  if (cs.status === 200) {
    await dump('champ-select-session.json', cs.text);
    try {
      const j = JSON.parse(cs.text);
      console.log(`top fields: ${fieldNames(j)}`);
      console.log(`localPlayerCellId=${j.localPlayerCellId}`);
      for (const key of ['myTeam', 'theirTeam']) {
        const team = j[key];
        if (!Array.isArray(team)) {
          console.log(`  ${key}: not an array`);
          continue;
        }
        console.log(`  ${key}: ${team.length} entries`);
        team.forEach((e, i) => {
          if (!isRecord(e)) return;
          console.log(
            `    [${i}] fields: ${fieldNames(e)}\n` +
              `        championId=${e.championId} skinId=${e.skinId} ` +
              `selectedSkinId=${e.selectedSkinId} ` +
              `cellId=${e.cellId} summonerId=${e.summonerId} playerId=${e.playerId} team=${e.team}`
          );
          if (e.cellId === j.localPlayerCellId) {
            console.log(`        >>> LOCAL PLAYER RAW: ${JSON.stringify(e)}`);
          }
        });
      }
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }

  // --------------------------------------------------------- 3. match history
  console.log('\n===== 3. match history =====');
  const mh = await call(
    '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=2'
  );
  console.log(`status=${mh.status} ${mh.error || ''}`);
  if (mh.status === 200) {
    await dump('match-history.json', mh.text);
    try {
      const j = JSON.parse(mh.text);
      let games = [];
      if (Array.isArray(j)) games = j;
      else if (j.games) {
        const b = j.games;
        if (Array.isArray(b)) games = b;
        else if (Array.isArray(b.games)) games = b.games;
        else if (isRecord(b.games)) games = Object.values(b.games);
        else if (isRecord(b)) games = Object.values(b);
      }
      console.log(`games parsed: ${games.length}`);
      games.slice(0, 3).forEach((g, gi) => {
        if (!isRecord(g)) return;
        console.log(`  --- game[${gi}] top fields: ${fieldNames(g)}`);
        console.log(
          `      gameId=${g.gameId} gameCreationDate=${g.gameCreationDate} ` +
            `gameDuration=${g.gameDuration} gameMode=${g.gameMode} queueId=${g.queueId} mapId=${g.mapId}`
        );
        const participants = Array.isArray(g.participants) ? g.participants : [];
        console.log(`      participants: ${participants.length}`);
        participants.slice(0, 2).forEach((p, pi) => {
          if (!isRecord(p)) return;
          console.log(`        [${pi}] fields: ${fieldNames(p)}`);
          console.log(
            `            championId=${p.championId} skinId=${p.skinId} skin=${p.skin} ` +
              `participantId=${p.participantId} itemSkinId=${p.itemSkinId}`
          );
          if (isRecord(p.stats)) {
            console.log(`            stats fields: ${fieldNames(p.stats)}`);
          }
        });
      });
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }

  // ------------------------------------------------------------- 4. skins.json
  console.log('\n===== 4. client skins.json (reverse-lookup table) =====');
  const sk = await call('/lol-game-data/assets/v1/skins.json');
  console.log(`status=${sk.status} ${sk.error || ''} bytes=${sk.bytes}`);
  if (sk.status === 200) {
    await dump('skins.json', sk.text);
    try {
      const j = JSON.parse(sk.text);
      const list = toEntries(j);
      console.log(`shape: ${Array.isArray(j) ? 'array' : 'dict'} entries=${list.length}`);
      for (const e of list.slice(0, 2)) {
        console.log(`  sample fields: ${fieldNames(e)}`);
        console.log(`  sample: ${JSON.stringify(e).slice(0, 500)}`);
      }
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }

  // ------------------------------------ 4b. champion-summary 的皮肤编号清单
  // 用来核对「皮肤序号 -> 皮肤 id」这条换算规则。
  console.log('\n===== 4b. champion-summary.json (每个英雄的皮肤编号) =====');
  const csum = await call('/lol-game-data/assets/v1/champion-summary.json');
  console.log(`status=${csum.status} ${csum.error || ''} bytes=${csum.bytes}`);
  if (csum.status === 200) {
    await dump('champion-summary.json', csum.text);
    try {
      const j = JSON.parse(csum.text);
      const list = toEntries(j);
      const keyed = toKeyedEntries(j);
      console.log(`shape: ${Array.isArray(j) ? 'array' : 'dict'} entries=${list.length}`);
      if (list.length > 0) {
        console.log(`  sample fields: ${fieldNames(list[0])}`);
        console.log(`  sample: ${JSON.stringify(list[0]).slice(0, 600)}`);
      }
      // 每个英雄的皮肤编号清单 —— 跟 staticData.ts 的 parseLcuSkinIds 同一套逻辑,
      // 两种形状都认(平铺 skinId / 挂在英雄下面的 skins 数组)。
      const byChamp = new Map();
      const addSkin = (cid, sid) => {
        if (!cid || !sid) return;
        if (!byChamp.has(cid)) byChamp.set(cid, []);
        const arr = byChamp.get(cid);
        if (!arr.includes(sid)) arr.push(sid);
      };
      // 先认清楚哪些编号是英雄编号(跟 staticData.ts 的 parseLcuSkinIds 同一套判据)
      const championIds = new Set();
      for (const { key, entry: e } of keyed) {
        const entryId = Number(e.id) || 0;
        if (Number(e.skinId) > 0) championIds.add(entryId);
        if (Array.isArray(e.skins) && e.skins.length) {
          championIds.add(Number(e.championId) || entryId || Number(key) || 0);
        }
      }
      for (const { key, entry: e } of keyed) {
        const entryId = Number(e.id) || 0;
        const skinIdField = Number(e.skinId) || 0;
        if (skinIdField) {
          // 皮肤 id = 英雄编号 × 1000 + 序号 -> 英雄编号由皮肤 id 反推
          const derived = Math.floor(skinIdField / 1000);
          const cid = entryId && entryId < 1000 && entryId !== derived ? entryId : derived;
          addSkin(cid, skinIdField);
          continue;
        }
        const skins = Array.isArray(e.skins) ? e.skins.filter(isRecord) : [];
        if (skins.length) {
          const cid = Number(e.championId) || entryId || Number(key) || 0;
          for (const s of skins) addSkin(cid, Number(s.id) || Number(s.skinId) || 0);
          continue;
        }
        if (entryId < 1000 || championIds.has(entryId)) {
          const cid = entryId || Number(key) || 0;
          if (cid) addSkin(cid, cid * 1000);
        } else {
          addSkin(Math.floor(entryId / 1000), entryId);
        }
      }
      const totalSkins = [...byChamp.values()].reduce((n, arr) => n + arr.length, 0);
      console.log(`heroes with skins: ${byChamp.size}, skin ids total: ${totalSkins}`);
      const flatCount = keyed.filter(({ entry: e }) => Number(e.skinId) > 0).length;
      const nestedCount = keyed.filter(({ entry: e }) => Array.isArray(e.skins) && e.skins.length).length;
      console.log(`  条目形状: 平铺 skinId 的 ${flatCount} 条 / 带 skins 数组的 ${nestedCount} 条`);
      let shown = 0;
      for (const [cid, ids] of byChamp) {
        if (shown >= 8) break;
        ids.sort((a, b) => a - b);
        console.log(`  champion ${cid}: ${ids.join(', ')}`);
        shown += 1;
      }
      // 重点抽查:皮肤 id 是不是「英雄编号 × 1000 + 序号」
      console.log('  -- 抽查「皮肤 id % 1000 == 序号」这条规则 --');
      for (const [cid, ids] of [...byChamp].slice(0, 200)) {
        const bad = ids.filter((sid) => Math.floor(sid / 1000) !== cid);
        if (bad.length) console.log(`    champion ${cid}: 不符规则的 id -> ${bad.join(', ')}`);
      }
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }

  // ------------------------------------------------------- 5. live client 2999
  console.log('\n===== 5. live client data (2999) =====');
  const live = await request('https', 2999, '/liveclientdata/allgamedata', null);
  console.log(`status=${live.status} ${live.error || ''}`);
  if (live.status === 200) {
    await dump('liveclient-allgamedata.json', live.text);
    try {
      const j = JSON.parse(live.text);
      console.log(`top fields: ${fieldNames(j)}`);
      const ap = isRecord(j.activePlayer) ? j.activePlayer : {};
      console.log(`activePlayer fields: ${fieldNames(ap)}`);
      console.log(
        `activePlayer: summonerName=${ap.summonerName} championName=${ap.championName} ` +
          `riotIdGameName=${ap.riotIdGameName} riotIdTagLine=${ap.riotIdTagLine}`
      );
      const players = Array.isArray(j.allPlayers) ? j.allPlayers : [];
      console.log(`allPlayers: ${players.length}`);
      players.slice(0, 2).forEach((p, i) => {
        if (!isRecord(p)) return;
        console.log(`  [${i}] fields: ${fieldNames(p)}`);
        console.log(
          `      summonerName=${p.summonerName} championName=${p.championName} skin=${p.skin} ` +
            `championId=${p.championId}`
        );
      });
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }
  const liveStats = await request('https', 2999, '/liveclientdata/playerstats', null);
  console.log(`playerstats status=${liveStats.status} ${liveStats.error || ''}`);
  if (liveStats.status === 200) {
    await dump('liveclient-playerstats.json', liveStats.text);
    try {
      const j = JSON.parse(liveStats.text);
      console.log(`playerstats top fields: ${fieldNames(j)}`);
      const ap = isRecord(j.activePlayer) ? j.activePlayer : {};
      console.log(`playerstats.activePlayer fields: ${fieldNames(ap)}`);
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }

  // ------------------------------------------------- 6. tencent ledge match data
  // 服务端视角的「我这局用了什么皮肤」——如果腾讯战绩里带皮肤字段,
  // 那就是局末最稳的一条路(而且能回查任意历史对局)。
  console.log('\n===== 6. tencent ledge match history (server side) =====');
  const tokenRes = await call('/lol-league-session/v1/league-session-token');
  const rawToken = tokenRes.status === 200 ? tokenRes.text.trim() : '';
  const token = rawToken.replace(/^"|"$/g, '');
  console.log(`session token status=${tokenRes.status} len=${token.length}`);
  if (token && puuid) {
    const path =
      `/match-history-query/v1/products/lol/player/${encodeURIComponent(puuid)}/SUMMARY` +
      `?startIndex=0&count=2&tagsQueryType=AND`;
    const res = await new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'tj101-sgp.lol.qq.com',
          port: 21019,
          path,
          method: 'GET',
          rejectUnauthorized: false,
          timeout: 15000,
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
        },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () =>
            resolve({ status: r.statusCode, text: Buffer.concat(chunks).toString('utf8') })
          );
        }
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 0, text: '' });
      });
      req.on('error', () => resolve({ status: 0, text: '' }));
      req.end();
    });
    console.log(`ledge status=${res.status} bytes=${res.text.length}`);
    if (res.status === 200) {
      await dump('ledge-summary.json', res.text);
      try {
        const j = JSON.parse(res.text);
        const games = Array.isArray(j) ? j : Array.isArray(j.games) ? j.games : [];
        console.log(`games: ${games.length}`);
        const g = games[0];
        const json = g && isRecord(g.json) ? g.json : {};
        const participants = Array.isArray(json.participants) ? json.participants.filter(isRecord) : [];
        console.log(`participants: ${participants.length}`);
        const mine = participants.find((p) => String(p.puuid || '') === puuid) || participants[0];
        if (mine) {
          console.log(`MY PARTICIPANT fields: ${fieldNames(mine)}`);
          console.log(`MY PARTICIPANT RAW: ${JSON.stringify(mine).slice(0, 1500)}`);
        }
      } catch (e) {
        console.log(`not JSON: ${e.message}`);
      }
    }
  }

  console.log(`\ndumps written to ${DUMP_DIR}`);
}

main().catch((err) => {
  console.log(`fatal: ${err && err.message ? err.message : String(err)}`);
});
