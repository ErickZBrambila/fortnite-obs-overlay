// Fortnite OBS Bridge — Overwolf GEP → Node.js server
// Runs as a background-only Overwolf app.
// Subscribes to Fortnite Game Events Provider and forwards everything
// to http://localhost:PORT/api/gep-event (configurable below).

const FORTNITE_GAME_ID = 21216;
const SERVER_URL       = 'http://localhost:3000/api/gep-event';
const RETRY_DELAY_MS   = 5000;

const GEP_FEATURES = [
  'kill',        // cumulative kill count, knockdowns
  'death',       // local player eliminated
  'knocked_out', // local player downed
  'revived',     // local player revived by teammate
  'match_info',  // game_mode, match_started, match_ended, pseudo_match_id
  'rank',        // final placement, alive_players
  'team',        // squad member names, alive/knocked state
  'phase',       // lobby / airfield / ingame / endgame
];

let featuresSet = false;

// ── Forward payload to the local server ──────────────────────────────────────
function forward(payload) {
  fetch(SERVER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  }).catch(() => {
    // Server not running yet — silent fail, events will resume when it's up
  });
}

// ── Register GEP features ────────────────────────────────────────────────────
function setupGEP() {
  overwolf.games.events.setRequiredFeatures(GEP_FEATURES, (result) => {
    if (result.status === 'success') {
      console.log('[bridge] GEP features registered:', GEP_FEATURES.join(', '));
      featuresSet = true;
    } else {
      console.warn('[bridge] setRequiredFeatures failed — retrying in 5s:', result);
      setTimeout(setupGEP, RETRY_DELAY_MS);
    }
  });
}

// ── GEP: real-time events (kill, death, knocked, etc.) ───────────────────────
overwolf.games.events.onNewEvents.addListener((data) => {
  if (!data || !data.events) return;
  data.events.forEach((evt) => {
    let parsed;
    try { parsed = typeof evt.data === 'string' ? JSON.parse(evt.data) : (evt.data || {}); }
    catch { parsed = {}; }
    console.log(`[bridge] event: ${evt.name}`, parsed);
    forward({ type: 'event', name: evt.name, data: parsed });
  });
});

// ── GEP: info/state updates (team members, rank, phase, match_info) ──────────
overwolf.games.events.onInfoUpdates2.addListener((data) => {
  if (!data || !data.feature) return;
  console.log(`[bridge] info update: ${data.feature}`, data.info);
  forward({ type: 'info', feature: data.feature, info: data.info });
});

// ── Watch for Fortnite launch / exit ─────────────────────────────────────────
overwolf.games.onGameInfoUpdated.addListener((res) => {
  if (!res || !res.gameInfo) return;
  const id = Math.floor(res.gameInfo.id / 10); // Overwolf sometimes appends a digit
  const isFortnite = id === FORTNITE_GAME_ID || res.gameInfo.id === FORTNITE_GAME_ID;

  if (res.gameInfo.isRunning && isFortnite) {
    if (!featuresSet) {
      console.log('[bridge] Fortnite detected — setting up GEP...');
      setupGEP();
    }
  } else if (isFortnite) {
    console.log('[bridge] Fortnite exited — resetting feature state');
    featuresSet = false;
    forward({ type: 'event', name: 'game_exit', data: {} });
  }
});

// ── Check if Fortnite is already running when the app starts ─────────────────
overwolf.games.getRunningGameInfo((res) => {
  if (!res || !res.id) {
    console.log('[bridge] No game running — waiting for Fortnite launch');
    return;
  }
  const id = Math.floor(res.id / 10);
  if (id === FORTNITE_GAME_ID || res.id === FORTNITE_GAME_ID) {
    console.log('[bridge] Fortnite already running — setting up GEP...');
    setupGEP();
  } else {
    console.log(`[bridge] Game ${res.id} running (not Fortnite) — waiting`);
  }
});
