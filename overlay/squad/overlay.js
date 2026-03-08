/* ── Fortnite OBS Squad Overlay ─────────────────────────────────────────────── */

const WS_URL = `ws://${location.host}`;
const RECONNECT_DELAY_MS = 3000;

let ws = null;
let sessionStart = null;
let timerInterval = null;

const PLATFORM_LABELS = { pc: 'PC', ps5: 'PS5', xbox: 'XBX', switch: 'NSW', mobile: 'MOB' };
const MODE_LABELS = { solo: 'SOLO', duo: 'DUOS', squad: 'SQUADS', overall: 'ALL MODES' };

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
}

// ── Screen toggle ─────────────────────────────────────────────────────────────
function show(id) {
  ['squadPanel', 'idleScreen'].forEach((sid) => {
    const el = document.getElementById(sid);
    if (el) el.classList.toggle('hidden', sid !== id);
  });
}

// ── Session timer ─────────────────────────────────────────────────────────────
function startTimer(isoStart) {
  sessionStart = new Date(isoStart);
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
  document.getElementById('squadTimer').textContent =
    `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Player card HTML ──────────────────────────────────────────────────────────
function playerCardHTML(p, slot) {
  const s    = p.session;
  const kills   = s?.kills ?? 0;
  const deaths  = s?.deaths ?? 0;
  const kd      = (s?.kd ?? 0).toFixed(2);
  const matches = s?.matches ?? 0;
  const wins    = s?.wins ?? 0;
  const winRate = (s?.winRate ?? 0).toFixed(1);
  const level   = p.battlePass?.level ? `LVL ${p.battlePass.level}` : '';
  const plat    = PLATFORM_LABELS[p.platform] ?? (p.platform ?? '').toUpperCase();
  const dotCls  = p.error ? 'fn-dot error' : 'fn-dot live';
  const label   = p.label || p.username || '—';
  const name    = (p.username || '—').toUpperCase();
  const errHtml = p.error ? `<div class="card-error">${p.error}</div>` : '';

  return `
    <div class="player-card" data-slot="${slot}">
      <div class="card-header">
        <span class="card-platform">${plat}</span>
        <span class="card-label">${label}</span>
        <span class="card-level">${level}</span>
        <div class="${dotCls} card-dot"></div>
      </div>
      <div class="card-name">${name}</div>
      <div class="kd-strip">
        <div class="kd-item">
          <div class="fn-label">Kills</div>
          <div class="fn-value fn-value-accent fn-value-lg">${kills}</div>
        </div>
        <div class="kd-sep"></div>
        <div class="kd-item">
          <div class="fn-label">K/D</div>
          <div class="fn-value fn-value-gold fn-value-lg">${kd}</div>
        </div>
        <div class="kd-sep"></div>
        <div class="kd-item">
          <div class="fn-label">Deaths</div>
          <div class="fn-value fn-value-lg">${deaths}</div>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-item">
          <div class="fn-label">Matches</div>
          <div class="fn-value">${matches}</div>
        </div>
        <div class="stat-item">
          <div class="fn-label">Wins</div>
          <div class="fn-value fn-value-gold">${wins}</div>
        </div>
        <div class="stat-item">
          <div class="fn-label">Win%</div>
          <div class="fn-value">${winRate}%</div>
        </div>
      </div>
      ${errHtml}
    </div>
  `;
}

// ── Render squad ──────────────────────────────────────────────────────────────
function renderSquad(msg) {
  const players = msg.players ?? [];
  if (players.length === 0) { show('idleScreen'); return; }

  const grid = document.getElementById('squadGrid');
  grid.innerHTML = players.map((p, i) => playerCardHTML(p, i)).join('');

  // Resize body to fit player count (210px per card + 1px gaps)
  const totalWidth = players.length * 210 + (players.length - 1);
  document.body.style.width = `${totalWidth}px`;
  document.getElementById('squadPanel').style.width = `${totalWidth}px`;

  // Mode badge — use most common active mode across squad
  const modes = players.map(p => p.session?.activeMode).filter(Boolean);
  const modeBadge = document.getElementById('modeBadge');
  if (modes.length > 0) {
    const mode = modes.sort((a, b) =>
      modes.filter(m => m === b).length - modes.filter(m => m === a).length
    )[0];
    modeBadge.textContent = MODE_LABELS[mode] ?? mode.toUpperCase();
    modeBadge.classList.remove('hidden');
  } else {
    modeBadge.classList.add('hidden');
  }

  // Session timer from earliest start
  if (!sessionStart) {
    const starts = players
      .map(p => p.session?.startTime)
      .filter(Boolean)
      .map(s => new Date(s).getTime());
    if (starts.length) startTimer(new Date(Math.min(...starts)).toISOString());
  }

  if (msg.updatedAt) {
    const d = new Date(msg.updatedAt);
    document.getElementById('lastUpdated').textContent =
      `Updated ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  show('squadPanel');
}

// ── Log events — update squad kill counts in real-time ───────────────────────
// (log_kill fires when PC log detects a kill — the killer is whoever set_player is)
function handleLogKill() {
  // Visually flash the first PC player's kills value
  const pcCard = document.querySelector('[data-slot="0"] .fn-value-accent');
  if (!pcCard) return;
  pcCard.classList.add('kill-flash');
  setTimeout(() => pcCard.classList.remove('kill-flash'), 800);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => console.log('[ws] squad connected'));

  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    switch (msg.type) {
      case 'theme_change':
        applyTheme(msg.theme);
        break;
      case 'squad_update':
        renderSquad(msg);
        break;
      case 'log_kill':
        handleLogKill();
        break;
      case 'idle':
        show('idleScreen');
        break;
    }
  });

  ws.addEventListener('close', () => {
    console.log('[ws] squad disconnected — reconnecting…');
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.addEventListener('error', () => ws.close());
}

connect();
