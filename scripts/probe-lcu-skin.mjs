#!/usr/bin/env node
/**
 * Probe every candidate source for "which skin did I use this game".
 *
 * The four fallbacks in src/main/match/usedSkin.ts were written from guesses and
 * never probed against the CN client. This dumps the raw payloads of all of them
 * so we can see what the client actually gives us.
 *
 * Run with the game client open (a finished game is fine - match history and
 * gameflow both keep their data for a while):
 *   node scripts\probe-lcu-skin.mjs
 *
 * ASCII output on purpose: PowerShell 5.1 cannot do the TLS handshake with the
 * CN client's self-signed LCU, but Node can.
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
  return typeof v === 'object' && v !== null;
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

  const call = async (path) => request(base, usePort, path, auth);

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
              `teamOwner=${e.teamOwner} ` +
              `puuid=${String(e.puuid || '').slice(0, 12)} name=${e.summonerName || e.riotIdGameName || ''}`
          );
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
              `        championId=${e.championId} skinId=${e.skinId} cellId=${e.cellId} ` +
              `summonerId=${e.summonerId} playerId=${e.playerId} team=${e.team}`
          );
          if (Array.isArray(e.champions)) {
            e.champions.forEach((c) => {
              if (!isRecord(c)) return;
              console.log(
                `        champion option: championId=${c.championId} skinId=${c.skinId} ` +
                  `fields: ${fieldNames(c)}`
              );
              if (Array.isArray(c.skins)) {
                c.skins.forEach((s) => {
                  if (!isRecord(s)) return;
                  console.log(
                    `            skin: skinId=${s.skinId} name=${s.name} displayName=${s.displayName}`
                  );
                });
              }
            });
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
      games.forEach((g, gi) => {
        if (!isRecord(g)) return;
        console.log(`  --- game[${gi}] top fields: ${fieldNames(g)}`);
        console.log(
          `      gameId=${g.gameId} gameCreation=${g.gameCreation} gameCreationDate=${g.gameCreationDate} ` +
            `gameDuration=${g.gameDuration} gameMode=${g.gameMode} queueId=${g.queueId} mapId=${g.mapId}`
        );
        const participants = Array.isArray(g.participants) ? g.participants : [];
        console.log(`      participants: ${participants.length}`);
        participants.forEach((p, pi) => {
          if (!isRecord(p)) return;
          console.log(`        [${pi}] fields: ${fieldNames(p)}`);
          console.log(
            `            championId=${p.championId} skinId=${p.skinId} skin=${p.skin} ` +
              `participantId=${p.participantId} itemSkinId=${p.itemSkinId}`
          );
        });
        const identities = Array.isArray(g.participantIdentities) ? g.participantIdentities : [];
        console.log(`      participantIdentities: ${identities.length}`);
        identities.forEach((id) => {
          if (!isRecord(id)) return;
          const p = isRecord(id.player) ? id.player : {};
          console.log(
            `        participantId=${id.participantId} puuid=${String(p.puuid || '').slice(0, 12)} ` +
              `gameName=${p.gameName || p.summonerName || ''}`
          );
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
    try {
      const j = JSON.parse(sk.text);
      const list = Array.isArray(j) ? j : [];
      console.log(`entries: ${list.length}`);
      for (const e of list.slice(0, 3)) {
        if (!isRecord(e)) continue;
        console.log(`  sample fields: ${fieldNames(e)}`);
        console.log(`  sample: ${JSON.stringify(e).slice(0, 400)}`);
      }
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }

  // ------------------------------------ 4b. champion-summary 的皮肤编号清单
  // 用来核对「皮肤序号 → 皮肤 id」这条换算规则:
  // 若某英雄的皮肤编号是 103001、103002、103003…… 那序号就是 1、2、3。
  console.log('\n===== 4b. champion-summary.json (每个英雄的皮肤编号) =====');
  const csum = await call('/lol-game-data/assets/v1/champion-summary.json');
  console.log(`status=${csum.status} ${csum.error || ''} bytes=${csum.bytes}`);
  if (csum.status === 200) {
    try {
      const j = JSON.parse(csum.text);
      const list = Array.isArray(j) ? j : [];
      const byChamp = new Map();
      for (const e of list) {
        if (!isRecord(e)) continue;
        const sid = Number(e.skinId);
        const cid = Number(e.id);
        if (!Number.isFinite(sid) || sid === 0) continue;
        if (!Number.isFinite(cid) || cid === 0) continue;
        if (!byChamp.has(cid)) byChamp.set(cid, []);
        byChamp.get(cid).push(sid);
      }
      console.log(`带皮肤条目的英雄数=${byChamp.size}`);
      for (const [cid, ids] of byChamp) {
        ids.sort((a, b) => a - b);
        console.log(`  英雄 ${cid}: ${ids.join(', ')}`);
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
      players.forEach((p, i) => {
        if (!isRecord(p)) return;
        console.log(
          `  [${i}] summonerName=${p.summonerName} championName=${p.championName} skin=${p.skin} ` +
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
    try {
      const j = JSON.parse(liveStats.text);
      console.log(`playerstats top fields: ${fieldNames(j)}`);
      const ap = isRecord(j.activePlayer) ? j.activePlayer : {};
      console.log(`playerstats.activePlayer fields: ${fieldNames(ap)}`);
      console.log(`playerstats.activePlayer raw: ${JSON.stringify(ap).slice(0, 600)}`);
    } catch (e) {
      console.log(`not JSON: ${e.message}`);
    }
  }
}

main().catch((err) => {
  console.log(`fatal: ${err && err.message ? err.message : String(err)}`);
});
