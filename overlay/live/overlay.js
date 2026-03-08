/* ── Fortnite OBS Live Overlay ─────────────────────────────────────────────── */

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
  playerName:   document.getElementById('playerName'),
  bpLevel:      document.getElementById('bpLevel'),
  modeBadge:    document.getElementById('modeBadge'),
  sesKills:     document.getElementById('sesKills'),
  sesDeaths:    document.getElementById('sesDeaths'),
  sesKD:        document.getElementById('sesKD'),
  sesMatches:   document.getElementById('sesMatches'),
  sesWins:      document.getElementById('sesWins'),
  sesWinRate:   document.getElementById('sesWinRate'),
  sessionTimer: document.getElementById('sessionTimer'),
  lastUpdated:  document.getElementById('lastUpdated'),
  loadingMsg:   document.getElementById('loadingMsg'),
  errorMsg:     document.getElementById('errorMsg'),
  usernameInput:document.getElementById('usernameInput'),
  startBtn:     document.getElementById('startBtn'),
  retryBtn:     document.getElementById('retryBtn'),
};

// ── State ─────────────────────────────────────────────────────────────────────
let ws = null;
let sessionStart = null;
let timerInterval = null;
let lastUsername = null;

// ── Screen switching ──────────────────────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([key, node]) => {
    node.classList.toggle('hidden', key !== name);
  });
}

// ── Session timer ─────────────────────────────────────────────────────────────
function startTimer(startIso) {
  sessionStart = new Date(startIso);
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function updateTimer() {
  if (!sessionStart) return;
  const elapsed = Math.floor((Date.now() - sessionStart.getTime()) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  el.sessionTimer.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Render stats ──────────────────────────────────────────────────────────────
function renderStats(msg) {
  const { player, battlePass, session, lastUpdated } = msg;

  el.playerName.textContent = player ?? '—';
  el.bpLevel.textContent    = battlePass?.level ? `LVL ${battlePass.level}` : '';

  const modeLabels = { solo: 'SOLO', duo: 'DUOS', squad: 'SQUADS', overall: 'ALL MODES' };
  if (session.activeMode) {
    el.modeBadge.textContent = modeLabels[session.activeMode] ?? session.activeMode.toUpperCase();
    el.modeBadge.classList.remove('hidden');
  } else {
    el.modeBadge.classList.add('hidden');
  }

  el.sesKills.textContent   = session.kills ?? 0;
  el.sesDeaths.textContent  = session.deaths ?? 0;
  el.sesKD.textContent      = (session.kd ?? 0).toFixed(2);
  el.sesMatches.textContent = session.matches ?? 0;
  el.sesWins.textContent    = session.wins ?? 0;
  el.sesWinRate.textContent = `${(session.winRate ?? 0).toFixed(1)}%`;

  if (session.startTime && !sessionStart) startTimer(session.startTime);

  if (lastUpdated) {
    const d = new Date(lastUpdated);
    el.lastUpdated.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  showScreen('stats');
}

// ── Kill flash (real-time from log) ───────────────────────────────────────────
let killFlashTimer = null;
function flashKill(victim) {
  if (!el.sesKills) return;
  el.sesKills.classList.add('kill-flash');
  clearTimeout(killFlashTimer);
  killFlashTimer = setTimeout(() => el.sesKills.classList.remove('kill-flash'), 800);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    console.log('[ws] connected');
  });

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
      case 'theme_change':
        document.body.setAttribute('data-theme', msg.theme);
        break;
      case 'log_kill':
        flashKill(msg.victim);
        break;
      case 'session_reset':
        sessionStart = null;
        if (timerInterval) clearInterval(timerInterval);
        el.sessionTimer.textContent = '0:00:00';
        break;
      case 'error':
        el.errorMsg.textContent = msg.message ?? 'Unknown error';
        showScreen('error');
        break;
    }
  });

  ws.addEventListener('close', () => {
    console.log('[ws] disconnected — reconnecting…');
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.addEventListener('error', () => ws.close());
}

// ── Send helper ───────────────────────────────────────────────────────────────
function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── UI interactions ───────────────────────────────────────────────────────────
el.startBtn.addEventListener('click', () => {
  const username = el.usernameInput.value.trim();
  if (!username) return;
  lastUsername = username;
  send({ type: 'set_player', username });
  showScreen('loading');
  el.loadingMsg.textContent = `Loading ${username}…`;
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
