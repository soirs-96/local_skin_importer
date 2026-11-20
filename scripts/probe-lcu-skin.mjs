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

  // ---------------------------------------------- 0. skins.json(皮肤总目录)
  // 先拉它 —— 后面 gameflow / champ-select 拿到「皮肤线索」时,
  // 立刻能拿这个目录算出它到底指哪款皮肤。
  console.log('\n===== 0. skins.json (皮肤总目录 —— 判定皮肤线索的标尺) =====');
  const skinsByChamp = new Map();
  const skinById = new Map();
  const sk0 = await call('/lol-game-data/assets/v1/skins.json');
  console.log(`status=${sk0.status} ${sk0.error || ''} bytes=${sk0.bytes}`);
  if (sk0.status === 200) {
    await dump('skins.json', sk0.text);
    try {
      const j = JSON.parse(sk0.text);
      const list = toEntries(j);
      console.log(`shape: ${Array.isArray(j) ? 'array' : 'dict'} entries=${list.length}`);
      for (const e of list.slice(0, 2)) {
        console.log(`  sample fields: ${fieldNames(e)}`);
        console.log(`  sample: ${JSON.stringify(e).slice(0, 500)}`);
      }
      let noClass = 0;
      let classOther = 0;
      let droppedClass = 0;
      let droppedSuffix = 0;
      for (const e of list) {
        const id = Number(e.id) || 0;
        if (!id) continue;
        const cls = String(e.skinClassification || '');
        if (!cls) noClass += 1;
        else if (cls !== 'kChampion') {
          classOther += 1;
          droppedClass += 1;
          continue; // 不是英雄皮肤 → 不进对照表(跟 app 的 parseLcuSkins 一致)
        }
        const champ = Math.floor(id / 1000);
        const idx = id % 1000;
        // splash 文件名末尾的 _N 应当就是序号 —— 对不上就整条不收
        const suffix = String(e.splashPath || '');
        const sm = /_(\d+)\.jpg$/i.exec(suffix);
        if (sm && Number(sm[1]) !== idx) {
          droppedSuffix += 1;
          continue;
        }
        if (!skinsByChamp.has(champ)) skinsByChamp.set(champ, []);
        skinsByChamp.get(champ).push({ id, idx, e });
        skinById.set(id, e);
      }
      console.log(`对照表剔除: 非 kChampion ${droppedClass} 条, splash 后缀对不上 ${droppedSuffix} 条`);
      for (const arr of skinsByChamp.values()) arr.sort((a, b) => a.id - b.id);
      console.log(
        `heroes: ${skinsByChamp.size}, 无 skinClassification 的 ${noClass} 条, 非 kChampion 的 ${classOther} 条`
      );

      // splash 文件名末尾的 _N 是不是就是序号(全量原始条目,不是过滤后的)
      let mismatch = 0;
      let noSuffix = 0;
      for (const e of list) {
        const id = Number(e.id) || 0;
        if (!id) continue;
        const m = /_(\d+)\.jpg$/i.exec(String(e.splashPath || ''));
        if (!m) {
          noSuffix += 1;
          continue;
        }
        if (Number(m[1]) !== id % 1000) {
          mismatch += 1;
          if (mismatch <= 10) console.log(`  ! id=${id} 序号=${id % 1000} 但 splash 文件名是 ${m[1]}`);
        }
      }
      console.log(`splash 文件名后缀核对: 不一致 ${mismatch} 条, 认不出后缀 ${noSuffix} 条`);

      // 每个英雄的皮肤 id 是不是连续的 champ*1000, champ*1000+1, ...
      let gapChampions = 0;
      for (const [champ, arr] of skinsByChamp) {
        const ids = arr.map((x) => x.id);
        if (!ids.every((sid, i) => sid === champ * 1000 + i)) {
          gapChampions += 1;
          if (gapChampions <= 6) {
            console.log(
              `  ! champion ${champ} 的 id 不连续: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ' ...' : ''}`
            );
          }
        }
      }
      console.log(`id 不连续的英雄: ${gapChampions} / ${skinsByChamp.size}`);
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }

  /**
   * 把一条「皮肤线索」直接换算成皮肤,并把该英雄的皮肤清单打出来。
   *
   * 这样探测跑一次就能得出结论,不用人工对照。
   */
  const explainSkin = (champId, label, value) => {
    if (!champId || !Number.isFinite(value)) return;
    const arr = skinsByChamp.get(champId) || [];
    console.log(`        -- ${label}=${value} (英雄 ${champId} 共 ${arr.length} 款皮肤) --`);
    const shown = arr.slice(0, 40);
    for (const it of shown) {
      const marks = [];
      if (it.id === value) marks.push('« 皮肤 id 就是它');
      if (it.idx === value) marks.push('« 序号就是它');
      if (champId * 1000 + value === it.id) marks.push('« 编号差就是它');
      const pos = arr.indexOf(it);
      if (pos === value) marks.push('« 清单位置就是它');
      console.log(
        `           id=${it.id} 序号=${it.idx} 位置=${pos} 「${it.e.name}」${marks.length ? ' ' + marks.join(' ') : ''}`
      );
    }
    if (arr.length > shown.length) console.log(`           ... 还有 ${arr.length - shown.length} 款`);
  };

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
          const isSelf = e.teamOwner === true || (puuid && String(e.puuid || '') === puuid);
          if (isSelf) {
            console.log(
              `        >>> SELF ENTRY RAW (teamOwner=${e.teamOwner} puuidMatch=${!!(puuid && String(e.puuid || '') === puuid)}): ${JSON.stringify(e)}`
            );
            const champId = Number(e.championId) || 0;
            for (const key of ['selectedSkinId', 'lastSelectedSkinIndex', 'selectedSkinIndex', 'skinIndex', 'skinId']) {
              const v = e[key];
              if (typeof v === 'number' && Number.isFinite(v)) explainSkin(champId, key, v);
            }
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
            const champId = Number(e.championId) || 0;
            for (const key of ['selectedSkinId', 'skinId', 'lastSelectedSkinIndex', 'selectedSkinIndex', 'skinIndex']) {
              const v = e[key];
              if (typeof v === 'number' && Number.isFinite(v)) explainSkin(champId, key, v);
            }
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

  // skins.json 在第 0 段已经拉过并核对过了,这里不再重复。

  // ------------------------------------ 4b. champion-summary:英雄清单(不含皮肤)
  // 用途:把 skins.json splash 路径里的角色目录名(Characters/Annie)对上英雄编号。
  console.log('\n===== 4b. champion-summary.json (英雄清单) =====');
  const csum = await call('/lol-game-data/assets/v1/champion-summary.json');
  console.log(`status=${csum.status} ${csum.error || ''} bytes=${csum.bytes}`);
  const aliasToId = new Map();
  if (csum.status === 200) {
    await dump('champion-summary.json', csum.text);
    try {
      const j = JSON.parse(csum.text);
      const list = toEntries(j);
      console.log(`shape: ${Array.isArray(j) ? 'array' : 'dict'} entries=${list.length}`);
      if (list.length > 0) {
        console.log(`  sample fields: ${fieldNames(list[0])}`);
        console.log(`  sample: ${JSON.stringify(list[0]).slice(0, 600)}`);
      }
      // 到底有没有皮肤字段?—— 这次探测就是来回答这个的
      let withSkin = 0;
      for (const e of list) {
        const keys = Object.keys(e);
        if (keys.includes('skinId') || keys.includes('skins')) withSkin += 1;
        const cid = Number(e.id) || 0;
        const alias = String(e.alias || '');
        if (cid > 0 && alias) aliasToId.set(alias, cid);
      }
      console.log(`  带皮肤字段(skinId/skins)的条目: ${withSkin} / ${list.length}`);
      console.log(`  alias 映射条数: ${aliasToId.size}`);

      // 用 alias 交叉核对 skins.json:皮肤 id 除以 1000 是不是就是它自己的英雄
      if (skinById.size > 0) {
        let checked = 0;
        let wrong = 0;
        const examples = [];
        for (const [id, e] of skinById) {
          const p = String(e.splashPath || '');
          const m = /\/Characters\/([^/]+)\//i.exec(p);
          if (!m) continue;
          const champId = Math.floor(id / 1000);
          const realId = aliasToId.get(m[1]);
          checked += 1;
          if (realId !== undefined && realId !== champId) {
            wrong += 1;
            if (examples.length < 8) {
              examples.push(`id=${id} 目录=${m[1]}(英雄${realId}) 但 id/1000=${champId}`);
            }
          }
        }
        console.log(`  splash 目录名交叉核对: 查了 ${checked} 条, 对不上 ${wrong} 条`);
        for (const s of examples) console.log(`    ! ${s}`);
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
