// mock-log.js — simulates FortniteGame.log events over WebSocket
// Runs a full match loop: lobby → match start → kills → death/win → repeat

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3000';
const PLAYER = 'Out4blood04';

let ws;
let matchNum = 0;

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
    console.log(`[mock-log] → ${obj.type}`, obj.score !== undefined ? `(score=${obj.score})` : '');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runMatch() {
  matchNum++;
  const kills = Math.floor(Math.random() * 6) + 1; // 1–6 kills
  const win   = Math.random() < 0.2;               // 20% win rate
  const modes = ['solo', 'duo', 'squad'];
  const mode  = modes[Math.floor(Math.random() * modes.length)];

  console.log(`\n[mock-log] ── MATCH ${matchNum} (${mode}, ~${kills} kills, ${win ? 'WIN' : 'death'}) ──`);

  send({ type: 'log_match_start', gameMode: mode, playlist: `NoBuildBR_${mode.charAt(0).toUpperCase() + mode.slice(1)}`, timestamp: new Date().toISOString() });

  await sleep(2000);

  // Fire kills one at a time
  for (let k = 1; k <= kills; k++) {
    await sleep(1500 + Math.random() * 2000);
    send({ type: 'log_kill', killer: PLAYER, score: k, timestamp: new Date().toISOString() });
  }

  await sleep(2000);

  if (win) {
    send({ type: 'log_match_end', timestamp: new Date().toISOString() });
    console.log(`[mock-log]   Victory Royale!`);
  } else {
    send({ type: 'log_downed', timestamp: new Date().toISOString() });
    await sleep(800);
    send({ type: 'log_match_end', timestamp: new Date().toISOString() });
    console.log(`[mock-log]   Eliminated.`);
  }

  // Lobby cooldown before next match
  const lobby = 5000 + Math.random() * 3000;
  console.log(`[mock-log]   Waiting ${(lobby/1000).toFixed(1)}s in lobby...`);
  await sleep(lobby);
}

async function loop() {
  while (true) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      await runMatch();
    } else {
      await sleep(1000);
    }
  }
}

function connect() {
  console.log(`[mock-log] Connecting to ${WS_URL}...`);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`[mock-log] Connected. Starting match simulation for ${PLAYER}\n`);
    loop();
  });

  ws.on('close', () => {
    console.log('[mock-log] Disconnected — reconnecting in 2s...');
    setTimeout(connect, 2000);
  });

  ws.on('error', (e) => console.error('[mock-log] WS error:', e.message));
}

connect();
