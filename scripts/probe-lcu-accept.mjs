#!/usr/bin/env node
/**
 * Probe which LCU endpoints exist for accepting a champion select.
 *
 * Read-only: only GET requests, so running it can never accept a match.
 * Run it while the client is open (any phase):
 *   node scripts\probe-lcu-accept.mjs
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
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status: res.statusCode, text: buffer.toString('utf8') });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, text: '', error: 'timeout' });
    });
    req.on('error', (err) => resolve({ status: 0, text: '', error: err.message }));
    req.end();
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const cmdline = await readClientCmdline();
  if (!cmdline.trim()) {
    console.log('client command line not found - is the game client running?');
    return;
  }

  const appPort = arg(cmdline, 'app-port');
  const token = arg(cmdline, 'remoting-auth-token');
  console.log(`app-port=${appPort} token length=${token.length}`);

  let base = null;
  let auth = null;
  let port = 0;
  for (const proto of ['https', 'http']) {
    const candidate = Buffer.from(`riot:${token}`, 'ascii').toString('base64');
    const res = await request(proto, appPort, '/lol-summoner/v1/current-summoner', candidate);
    console.log(`try ${proto}://127.0.0.1:${appPort} -> ${res.status} ${res.error || ''}`);
    if (res.status === 200) {
      base = proto;
      auth = candidate;
      port = Number(appPort);
      break;
    }
  }
  if (!base) {
    console.log('no candidate endpoint answered 200');
    return;
  }
  console.log(`using ${base}://127.0.0.1:${port}`);
  console.log('');

  const call = async (p) => request(base, port, p, auth);

  // ---- 1. swagger / openapi: the authoritative route list ----
  const specPaths = [
    '/swagger/v1/openapi.json',
    '/swagger/v2/openapi.json',
    '/lol-champ-select/v1/openapi.json'
  ];
  for (const specPath of specPaths) {
    const res = await call(specPath);
    console.log(`${specPath} -> ${res.status} ${res.error || ''} (${res.text.length} bytes)`);
    if (res.status !== 200) continue;
    const spec = parseJson(res.text);
    if (!spec || !spec.paths) continue;
    const all = Object.keys(spec.paths);
    console.log(`  total paths: ${all.length}`);
    console.log('  --- paths containing "accept" ---');
    for (const p of all.filter((x) => /accept/i.test(x))) {
      console.log(`    ${p}  [${Object.keys(spec.paths[p]).join(',')}]`);
    }
    console.log('  --- paths containing "champ-select" ---');
    for (const p of all.filter((x) => /champ-select/i.test(x))) {
      console.log(`    ${p}  [${Object.keys(spec.paths[p]).join(',')}]`);
    }
    console.log('  --- paths containing "lobby" ---');
    for (const p of all.filter((x) => /lobby/i.test(x))) {
      console.log(`    ${p}  [${Object.keys(spec.paths[p]).join(',')}]`);
    }
    break;
  }

  // ---- 2. current phase / champ select state ----
  console.log('');
  const gf = await call('/lol-gameflow/v1/session');
  console.log(`/lol-gameflow/v1/session -> ${gf.status}`);
  if (gf.status === 200) {
    const json = parseJson(gf.text);
    if (json) {
      console.log(`  phase = ${JSON.stringify(json.phase)}`);
      console.log(`  fields = ${Object.keys(json).join(', ')}`);
    }
  }

  const cs = await call('/lol-champ-select/v1/session');
  console.log(`/lol-champ-select/v1/session -> ${cs.status}`);
  if (cs.status === 200) {
    const json = parseJson(cs.text);
    if (json) {
      console.log(`  fields = ${Object.keys(json).join(', ')}`);
      console.log(`  actions = ${JSON.stringify(json.actions)}`);
    }
  }

  // ---- 3. what do the candidate accept routes answer to a GET? ----
  console.log('');
  const candidates = [
    '/lol-champ-select/v1/accept',
    '/lol-champ-select/v1/session/actions/accept',
    '/lol-lobby/v2/lobby/matchmaking/accept',
    '/lol-matchmaking/v1/ready-check/accept'
  ];
  for (const c of candidates) {
    const res = await call(c);
    // 404 = 路径不存在;405 = 路径存在但方法不对 —— 这条就是端点存在的实锤。
    const hint = res.status === 405 ? '  <= 路径存在(方法不对)' : '';
    console.log(`GET  ${c} -> ${res.status} ${res.error || ''}${hint}`);
  }
}

main().catch((err) => {
  console.log(`fatal: ${err && err.message ? err.message : String(err)}`);
});
