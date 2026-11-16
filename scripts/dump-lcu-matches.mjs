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

  // 「我」是哪一个 participant —— 靠 puuid 在 participantIdentities 里定位。
  let myPuuid = '';
  const meRes = await call('/lol-summoner/v1/current-summoner');
  if (meRes.status === 200) {
    const me = parseJson(meRes.text);
    myPuuid = (me && me.puuid) || '';
    console.log(`summoner=${(me && me.displayName) || '?'} puuid=${myPuuid}`);
  }

  /** 打印一个对象里所有跟分路/定位沾边的字段。 */
  function positionFields(obj, prefix) {
    if (!obj || typeof obj !== 'object') return [];
    const rows = [];
    for (const [key, value] of Object.entries(obj)) {
      if (!/lane|role|position/i.test(key)) continue;
      rows.push(`${prefix}${key}=${JSON.stringify(value)}`);
    }
    return rows;
  }

  // 英雄名 / 道具名 —— 客户端自己就有(中文),不用出网。
  //
  // **LCU 的这两份是「id → 对象」的字典,不是 `{data:[...]}`** ——
  // 上一版按 `{data:[]}` 解析,结果 champions=0 items=0,名字全丢。
  // 两种形状都认,顺手把原始顶层键也打出来,免得再猜错。
  function assetEntries(body) {
    if (!body || typeof body !== 'object') return [];
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.data)) return body.data;
    return Object.values(body);
  }

  const championNames = new Map();
  const itemNames = new Map();
  const champRes = await call('/lol-game-data/assets/v1/champions.json');
  if (champRes.status === 200) {
    const body = parseJson(champRes.text);
    console.log(`champions.json 顶层键: ${Object.keys(body || {}).slice(0, 8).join(',')}`);
    for (const entry of assetEntries(body)) {
      if (entry && entry.id) championNames.set(String(entry.id), entry.name || '');
    }
  }
  const itemEntries = new Map();
  const itemRes = await call('/lol-game-data/assets/v1/items.json');
  if (itemRes.status === 200) {
    const body = parseJson(itemRes.text);
    console.log(`items.json 顶层键: ${Object.keys(body || {}).slice(0, 8).join(',')}`);
    for (const entry of assetEntries(body)) {
      if (entry && entry.id) {
        itemNames.set(String(entry.id), entry.name || '');
        itemEntries.set(String(entry.id), entry);
      }
    }
  }
  // champions.json 取不到就退回 champion-summary.json(数组形状,name 是称号,
  // description 才是英雄名 —— 短的那个才认)。
  if (championNames.size === 0) {
    const sumRes = await call('/lol-game-data/assets/v1/champion-summary.json');
    if (sumRes.status === 200) {
      const body = parseJson(sumRes.text);
      console.log(`champion-summary.json 顶层键: ${Object.keys(body || {}).slice(0, 8).join(',')}`);
      for (const entry of assetEntries(body)) {
        if (!entry || !entry.id) continue;
        const desc = String(entry.description || '').trim();
        const name = desc && desc.length <= 8 ? desc : String(entry.name || '');
        championNames.set(String(entry.id), name);
      }
    }
  }
  console.log(`champions=${championNames.size} items=${itemNames.size}`);

  // 收集用到的 roleBoundItem,最后把道具条目整个打出来(名字 + tags)。
  const boundItems = new Map();
  // gameId → 「我」的 participantId,详情里要标出来。
  const myParticipantIds = new Map();

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

    // 分路相关的原始字段 —— 「我」的那一条,以及全队的对照。
    const participants = Array.isArray(game.participants) ? game.participants : [];
    const identities = Array.isArray(game.participantIdentities) ? game.participantIdentities : [];
    let mine = participants[0];
    let mineId = '';
    if (myPuuid) {
      const identity = identities.find(
        (i) => i && i.player && i.player.puuid === myPuuid
      );
      if (identity) {
        mineId = identity.participantId;
        const found = participants.find((p) => p && p.participantId === identity.participantId);
        if (found) mine = found;
      }
    }
    const myStats = (mine && mine.stats) || {};
    const myTimeline = (mine && mine.timeline) || {};
    const fields = [...positionFields(myStats, 'stats.'), ...positionFields(myTimeline, 'timeline.')];
    const boundItem = myStats.roleBoundItem;
    if (boundItem && !boundItems.has(String(boundItem))) {
      boundItems.set(String(boundItem), itemNames.get(String(boundItem)) || '?');
    }
    const champId = mine && mine.championId;
    if (game.gameId) myParticipantIds.set(String(game.gameId), String(mineId));
    console.log(
      `  ME #${mineId || '?'} champ=${champId}(${championNames.get(String(champId)) || '?'}) ` +
        `${fields.join(' ') || '(无 lane/role 字段)'} ` +
        `boundItem=${boundItem}(${itemNames.get(String(boundItem)) || '?'}) ` +
        // playerSubteamId 就是 Riot 记的「队伍位置槽位」(1上 2打野 3中 4射手 5辅助)
        `slot=${myStats.playerSubteamId} placement=${myStats.subteamPlacement} ` +
        `perkStyle=${myStats.perkPrimaryStyle} perks=${myStats.perk0}/${myStats.perk1}/${myStats.perk2}/${myStats.perk3}`
    );
    if (Array.isArray(game.teams) && game.teams.length > 0) {
      console.log(`     teams: ${JSON.stringify(game.teams).slice(0, 600)}`);
    }
    console.log(`     stats keys: ${Object.keys(myStats).join(',')}`);
    console.log(`     timeline keys: ${Object.keys(myTimeline).join(',')}`);
    const inv = [];
    for (let i = 0; i <= 6; i += 1) {
      const id = myStats[`item${i}`];
      if (!id) continue;
      inv.push(`${id}=${itemNames.get(String(id)) || '?'}`);
    }
    console.log(`     items: ${inv.join(' | ') || '(空)'}`);
    console.log(
      `  TOP championId=${game.championId} championName=${JSON.stringify(game.championName)} ` +
        `statsFields=${positionFields(game.stats, 'stats.').join(' ') || '(无)'} ` +
        `participants=${participants.length} identities=${identities.length}`
    );
    console.log(`  TOP own fields: ${positionFields(game, '').join(' ') || '(无)'}`);
    console.log(
      '  all ' +
        participants
          .map(
            (p) =>
              `#${p && p.participantId} c${p && p.championId}(${championNames.get(String(p && p.championId)) || '?'}) ` +
              `${p && p.timeline ? p.timeline.lane : '?'}/${p && p.timeline ? p.timeline.role : '?'}`
          )
          .join(' | ')
    );
    out.push(game);
  }

  // 列表接口只回「我」一个人。详情接口才带全队 10 人 ——
  // 只有拿到全队,才能靠「一个队只有一个打野/一个射手」这类约束反推位置。
  console.log('');
  console.log('===================== 单场详情(全员) =====================');
  // 实测国服客户端这个端点是 404 —— 没有单场详情,拿不到全队 10 人。
  // 只探前 3 局,确认一下有没有变。
  for (const game of games.slice(0, 3)) {
    const gameId = game && game.gameId;
    if (!gameId) continue;
    const detailRes = await call(
      `/lol-match-history/v1/products/lol/current-summoner/matches/${gameId}`
    );
    const detail = parseJson(detailRes.text);
    const parts =
      detail && Array.isArray(detail.participants) ? detail.participants : [];
    console.log(`game ${gameId} detail=${detailRes.status} participants=${parts.length}`);
    if (!parts.length) continue;
    const myPid = myParticipantIds.get(String(gameId)) || '';
    for (const p of parts) {
      const isMe = myPid && String(p.participantId) === myPid;
      const st = (p && p.stats) || {};
      const tl = (p && p.timeline) || {};
      const inv = [];
      for (let i = 0; i <= 6; i += 1) {
        const id = st[`item${i}`];
        if (!id) continue;
        inv.push(`${id}=${itemNames.get(String(id)) || '?'}`);
      }
      const bound = st.roleBoundItem;
      console.log(
        `  ${isMe ? 'ME>' : '   '}#${p.participantId} c${p.championId}(${championNames.get(String(p.championId)) || '?'}) ` +
          `team=${p.teamId} lane=${tl.lane} role=${tl.role} ` +
          `champName=${JSON.stringify(p.championName)} ` +
          `bound=${bound}(${itemNames.get(String(bound)) || '?'}) ` +
          `kda=${st.kills}/${st.deaths}/${st.assists} ` +
          `items: ${inv.join(' | ') || '(空)'}`
      );
      if (isMe) {
        console.log(`     participant keys: ${Object.keys(p).join(',')}`);
        console.log(`     ME stats keys: ${Object.keys(st).join(',')}`);
        console.log(`     ME timeline keys: ${Object.keys(tl).join(',')}`);
      }
    }
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

  console.log('');
  console.log('===================== roleBoundItem 道具 =====================');
  for (const [id, name] of boundItems.entries()) {
    const entry = itemEntries.get(id);
    const tags = entry && Array.isArray(entry.tags) ? entry.tags.join(',') : '(无 tags)';
    const gold = entry && entry.gold ? JSON.stringify(entry.gold) : '';
    console.log(`  ${id} = ${name} | tags=${tags} | gold=${gold}`);
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
