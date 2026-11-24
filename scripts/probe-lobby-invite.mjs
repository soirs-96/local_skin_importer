#!/usr/bin/env node
/**
 * Probe which LCU endpoints exist for creating a lobby / inviting a friend.
 *
 * Method: send **GET** to a POST-only endpoint. A 405 means the route exists
 * (method rejected), a 404 means the route does not exist. This proves whether
 * a route is present without having to guess the request body.
 *
 * The first entry is the **calibration**: a known-existing GET endpoint hit
 * with POST. Only if the calibration answers 405 do we know this client really
 * uses 405 for "route present, method wrong" - otherwise every 405 below is
 * meaningless (the client may just answer 404 for everything).
 *
 * Run it while the game client is open (main menu):
 *   node scripts\probe-lobby-invite.mjs
 *
 * NOTE: every line printed here is ASCII on purpose - the console decodes
 * stdout as GBK, so non-ASCII output turns into mojibake.
 *
 * Port and token come from the **process command line** (same trick as
 * scripts\probe-lcu-skin.mjs) - the CN client does not keep its lockfile in
 * the Riot directory, so the command line is the more reliable source.
 */

import { execFile } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';

const CANDIDATES = [
  // calibration: a known-existing GET endpoint, hit with POST
  { method: 'POST', path: '/lol-summoner/v1/current-summoner', label: 'CALIBRATION' },
  { method: 'GET', path: '/lol-lobby/v2/lobby/invitations', label: 'v2 lobby invitations' },
  { method: 'GET', path: '/lol-lobby/v2/lobby', label: 'v2 lobby' },
  { method: 'GET', path: '/lol-lobby/v1/lobby/invitations', label: 'v1 lobby invitations' },
  { method: 'GET', path: '/lol-lobby/v2/party/invitations', label: 'v2 party invitations' },
  { method: 'GET', path: '/lol-lobby/v2/lobby/invite', label: 'v2 lobby invite' },
  { method: 'GET', path: '/lol-summoner/v1/summoners', label: 'summoners (search)' }
];

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
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

function probe(base, port, auth, candidate) {
  return new Promise((resolve) => {
    const client = base === 'https' ? https : http;
    const req = client.request(
      {
        hostname: '127.0.0.1',
        port,
        path: candidate.path,
        method: candidate.method,
        rejectUnauthorized: false,
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        timeout: 6000
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, note: '' });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, note: 'timeout' });
    });
    req.on('error', (err) => resolve({ status: 0, note: String((err && err.message) || err) }));
    req.end();
  });
}

async function main() {
  const cmdline = await readClientCmdline();
  if (!cmdline.trim()) {
    console.log('CLIENT_NOT_FOUND');
    console.log('Start the game client first (main menu), then run this again.');
    return;
  }
  const port = Number(arg(cmdline, 'app-port'));
  const token = arg(cmdline, 'remoting-auth-token');
  if (!port || !token) {
    console.log('NO_PORT_OR_TOKEN');
    return;
  }
  const auth = Buffer.from(`riot:${token}`, 'ascii').toString('base64');

  // The CN client uses https on some builds and http on others - try both.
  let base = null;
  for (const proto of ['https', 'http']) {
    const res = await probe(proto, port, auth, {
      method: 'GET',
      path: '/lol-summoner/v1/current-summoner'
    });
    console.log(`try ${proto}://127.0.0.1:${port} -> ${res.status} ${res.note}`);
    if (res.status === 200) {
      base = proto;
      break;
    }
  }
  if (!base) {
    console.log('NO_LIVE_ENDPOINT');
    return;
  }
  console.log(`using ${base}://127.0.0.1:${port}\n`);

  let calibrated = false;
  for (const candidate of CANDIDATES) {
    const res = await probe(base, port, auth, candidate);
    let verdict;
    if (res.status === 405) {
      verdict = 'EXISTS (405 = route present, method rejected)';
      if (candidate.label === 'CALIBRATION') calibrated = true;
    } else if (res.status === 404) {
      verdict = 'MISSING (404)';
    } else if (res.status === 200) {
      verdict = 'EXISTS (200)';
    } else {
      verdict = `UNKNOWN (${res.status} ${res.note})`;
    }
    console.log(candidate.label.padEnd(28) + candidate.path.padEnd(38) + '-> ' + verdict);
  }

  console.log('');
  if (!calibrated) {
    console.log('CALIBRATION_FAILED: this client does not answer 405 for a known route.');
    console.log('Treat every result above as unreliable.');
  }
  console.log(
    'Now replace the candidate list in src/main/lobby/invite.ts with the routes marked EXISTS.'
  );
}

void main();
