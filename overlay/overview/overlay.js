/* ── Fortnite OBS Overview Overlay ─────────────────────────────────────────── */

const WS_URL = `ws://${location.host}`;
const RECONNECT_DELAY_MS = 3000;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const screens = {
  idle:    document.getElementById('idleScreen'),
  loading: document.getElementById('loadingScreen'),
  error:   document.getElementById('errorScreen'),
  stats:   document.getElementById('statsPanel'),
};

const el = {
  playerName:    document.getElementById('playerName'),
  bpInfo:        document.getElementById('bpInfo'),
  // Overall
  allWins:       document.getElementById('allWins'),
  allKD:         document.getElementById('allKD'),
  allKills:      document.getElementById('allKills'),
  allWinRate:    document.getElementById('allWinRate'),
  allMatches:    document.getElementById('allMatches'),
  // Solos
  soloWins:      document.getElementById('soloWins'),
  soloKD:        document.getElementById('soloKD'),
  soloKills:     document.getElementById('soloKills'),
  soloMatches:   document.getElementById('soloMatches'),
  soloWinRate:   document.getElementById('soloWinRate'),
  soloKPM:       document.getElementById('soloKPM'),
  // Duos
  duoWins:       document.getElementById('duoWins'),
  duoKD:         document.getElementById('duoKD'),
  duoKills:      document.getElementById('duoKills'),
  duoMatches:    document.getElementById('duoMatches'),
  duoWinRate:    document.getElementById('duoWinRate'),
  duoKPM:        document.getElementById('duoKPM'),
  // Squads
  squadWins:     document.getElementById('squadWins'),
  squadKD:       document.getElementById('squadKD'),
  squadKills:    document.getElementById('squadKills'),
  squadMatches:  document.getElementById('squadMatches'),
  squadWinRate:  document.getElementById('squadWinRate'),
  squadKPM:      document.getElementById('squadKPM'),
  // Session
  sesKills:      document.getElementById('sesKills'),
  sesKD:         document.getElementById('sesKD'),
  sesMatches:    document.getElementById('sesMatches'),
  sesWins:       document.getElementById('sesWins'),
  // Misc
  lastUpdated:   document.getElementById('lastUpdated'),
  loadingMsg:    document.getElementById('loadingMsg'),
  errorMsg:      document.getElementById('errorMsg'),
  usernameInput: document.getElementById('usernameInput'),
  startBtn:      document.getElementById('startBtn'),
  retryBtn:      document.getElementById('retryBtn'),
};

let ws = null;
let lastUsername = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([key, node]) => {
    node.classList.toggle('hidden', key !== name);
  });
}

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fillMode(prefix, modeStats) {
  if (!modeStats) return;
  el[`${prefix}Wins`].textContent    = fmt(modeStats.wins);
  el[`${prefix}KD`].textContent      = fmt(modeStats.kd, 2);
  el[`${prefix}Kills`].textContent   = fmt(modeStats.kills);
  el[`${prefix}Matches`].textContent = fmt(modeStats.matches);
  el[`${prefix}WinRate`].textContent = `${fmt(modeStats.winRate, 1)}%`;
  el[`${prefix}KPM`].textContent     = fmt(modeStats.killsPerMatch, 2);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderStats(msg) {
  const { player, battlePass, stats, session, lastUpdated } = msg;

  el.playerName.textContent = player ?? '—';
  el.bpInfo.textContent = battlePass?.level
    ? `Battle Pass  LVL ${battlePass.level}  (${battlePass.progress ?? 0}%)`
    : '';

  // Overall
  const o = stats?.overall;
  if (o) {
    el.allWins.textContent    = fmt(o.wins);
    el.allKD.textContent      = fmt(o.kd, 2);
    el.allKills.textContent   = fmt(o.kills);
    el.allWinRate.textContent = `${fmt(o.winRate, 1)}%`;
    el.allMatches.textContent = fmt(o.matches);
  }

  // Modes
  fillMode('solo',  stats?.solo);
  fillMode('duo',   stats?.duo);
  fillMode('squad', stats?.squad);

  // Session
  el.sesKills.textContent   = session?.kills ?? 0;
  el.sesKD.textContent      = fmt(session?.kd, 2);
  el.sesMatches.textContent = session?.matches ?? 0;
  el.sesWins.textContent    = session?.wins ?? 0;

  if (lastUpdated) {
    const d = new Date(lastUpdated);
    el.lastUpdated.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  showScreen('stats');
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => console.log('[ws] connected'));

  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    switch (msg.type) {
      case 'idle':
        showScreen('idle');
        break;
      case 'loading':
        el.loadingMsg.textContent = `Loading ${msg.player}…`;
        showScreen('loading');
        break;
      case 'stats_update':
        renderStats(msg);
        break;
      case 'error':
        el.errorMsg.textContent = msg.message ?? 'Unknown error';
        showScreen('error');
        break;
      case 'theme_change':
        document.body.setAttribute('data-theme', msg.theme);
        break;
    }
  });

  ws.addEventListener('close', () => {
    console.log('[ws] disconnected — reconnecting…');
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.addEventListener('error', () => ws.close());
}

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── UI events ─────────────────────────────────────────────────────────────────
el.startBtn.addEventListener('click', () => {
  const username = el.usernameInput.value.trim();
  if (!username) return;
  lastUsername = username;
  send({ type: 'set_player', username });
  el.loadingMsg.textContent = `Loading ${username}…`;
  showScreen('loading');
});

el.usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.startBtn.click();
});

el.retryBtn.addEventListener('click', () => {
  if (lastUsername) {
    send({ type: 'set_player', username: lastUsername });
    showScreen('loading');
  } else {
    showScreen('idle');
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
connect();
