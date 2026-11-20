#!/usr/bin/env node
/**
 * Can we get the reference art (splash) for a skin, from this machine only?
 *
 * This is the feasibility probe for the "settlement screen background IS the
 * skin I used" fallback: that fallback only works if we can compare the
 * on-screen background against a set of candidate images. The candidates come
 * from the client's own skins.json, so everything has to be reachable over the
 * LCU loopback (no CDN, no Data Dragon - those are unreliable on CN).
 *
 * Run with the client open (no game needed):
 *   node scripts\probe-splash-fetch.mjs
 *   node scripts\probe-splash-fetch.mjs 266
 *
 * The optional argument is a champion id. It prints every candidate URL it
 * tries and whether the response actually looks like an image.
 */

import { execFile } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';

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

function request(base, port, urlPath, auth) {
  return new Promise((resolve) => {
    const client = base === 'https' ? https : http;
    const req = client.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        headers: auth ? { Authorization: `Basic ${auth}` } : {},
        timeout: 30000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            bytes: buffer.length,
            type: String(res.headers['content-type'] || ''),
            head: buffer.subarray(0, 4),
            text: buffer.toString('utf8'),
            error: ''
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 0,
        bytes: 0,
        type: '',
        head: Buffer.alloc(0),
        text: '',
        error: 'timeout'
      });
    });
    req.on('error', (err) => {
      resolve({
        status: 0,
        bytes: 0,
        type: '',
        head: Buffer.alloc(0),
        text: '',
        error: err.message
      });
    });
    req.end();
  });
}

/** JPEG starts with FF D8 FF; PNG with 89 50 4E 47. */
function looksLikeImage(res) {
  const h = res.head;
  if (h.length < 4) return false;
  if (h[0] === 0xff && h[1] === 0xd8) return true;
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return true;
  return false;
}

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toEntries(payload) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload)) return Object.values(payload).filter(isRecord);
  return [];
}

async function main() {
  const champArg = Number(process.argv[2] || 0);
  const champs = champArg > 0 ? [champArg] : [266, 1, 103, 64];

  const cmdline = await readClientCmdline();
  if (!cmdline.trim()) {
    console.log('Could not read the client command line. Is the game client running?');
    return;
  }
  const appPort = arg(cmdline, 'app-port');
  const remotingToken = arg(cmdline, 'remoting-auth-token');
  if (!appPort || !remotingToken) {
    console.log('No app-port / remoting-auth-token in the client command line.');
    return;
  }

  let base = null;
  let auth = null;
  let usePort = 0;
  for (const proto of ['https', 'http']) {
    const candidateAuth = Buffer.from(`riot:${remotingToken}`, 'ascii').toString('base64');
    const res = await request(proto, appPort, '/lol-summoner/v1/current-summoner', candidateAuth);
    console.log(`try ${proto}://127.0.0.1:${appPort} -> ${res.status}`);
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
  console.log(`using ${base}://127.0.0.1:${usePort}\n`);

  const call = async (p) => request(base, usePort, p, auth);

  const sk = await call('/lol-game-data/assets/v1/skins.json');
  console.log(`skins.json status=${sk.status} bytes=${sk.bytes}`);
  if (sk.status !== 200) return;

  const list = toEntries(JSON.parse(sk.text));
  console.log(`skin entries: ${list.length}\n`);

  for (const champ of champs) {
    const skins = list.filter((e) => {
      const id = Number(e.id) || 0;
      if (!id) return false;
      const cls = String(e.skinClassification || '');
      if (cls && cls !== 'kChampion') return false;
      return Math.floor(id / 1000) === champ;
    });
    console.log(`===== champion ${champ}: ${skins.length} skins =====`);
    if (skins.length === 0) continue;

    for (const e of skins.slice(0, 3)) {
      const id = Number(e.id) || 0;
      const splash = String(e.splashPath || '');
      const uncentered = String(e.uncenteredSplashPath || '');
      const loadScreen = String(e.loadScreenPath || '');
      console.log(`  skin id=${id} name=${e.name}`);
      console.log(`    splashPath       = ${splash}`);
      console.log(`    uncenteredSplash = ${uncentered}`);
      console.log(`    loadScreenPath   = ${loadScreen}`);

      const candidates = [];
      const push = (u) => {
        if (u && !candidates.includes(u)) candidates.push(u);
      };
      for (const p of [splash, uncentered, loadScreen]) {
        if (!p) continue;
        if (/^https?:\/\//i.test(p)) {
          console.log(`    [external-url] ${p.slice(0, 140)}`);
          continue;
        }
        // 本机磁盘路径(客户端把美术资源放在安装目录里)
        const winAbs = /^[a-zA-Z]:[\\/]/.test(p);
        if (winAbs) {
          console.log(`    [disk] ${p.slice(0, 140)} exists=${fs.existsSync(p)}`);
          continue;
        }
        // 客户端回环资源根,几种挂载前缀都试
        const m = /(\/Characters\/.*)$/i.exec(p);
        if (m) push(`/lol-game-data/assets/v1${m[1]}`);
        push(`/lol-game-data/assets/v1${p}`);
        push(p);
      }

      for (const c of candidates) {
        const r = await call(c);
        const ok = looksLikeImage(r);
        console.log(
          `    [lcu] ${c.slice(0, 140)} -> status=${r.status} bytes=${r.bytes} ` +
            `type=${r.type} ${ok ? 'IMAGE-OK' : ''}${r.error ? ' err=' + r.error : ''}`
        );
      }
      console.log('');
    }
  }
  console.log('done');
}

main().catch((err) => {
  console.log(`fatal: ${err && err.message ? err.message : String(err)}`);
});
