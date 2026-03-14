// simulate-log.js — replay all Fortnite log files and reconstruct match timelines
const fs   = require('fs');
const path = require('path');
const rl   = require('readline');

const LOG_DIR = 'C:/Users/erick/AppData/Local/FortniteGame/Saved/Logs';

// ── Patterns ─────────────────────────────────────────────────────────────────
const P_TIMESTAMP   = /^\[(\d{4}\.\d{2}\.\d{2}-(\d{2})\.(\d{2})\.(\d{2}):\d{3})\]/;
const P_MATCH_STATE = /Log(?:GameState|GameMode.*Display): Match State Changed from (\w+) to (\w+)/;
const P_KILL_SCORE  = /AFortPlayerStateAthena::OnRep_Kills\(\) \(KillScore = (\d+)\)/;
const P_PLAYLIST    = /PLAYLIST: Playlist Object finished loading.*PlaylistName is ([\w_]+)/;
const P_PARTY_ADD   = /New party member state for \[([^\]]+)\]/;
const P_LOGIN       = /process_user_login.*DisplayName=\[([^\]]+)\]/;
const P_DEATH_LOCAL = /LogSpectateAfterDeathViewTarget.*\[([^\]]+)\]\s+No teammates/;
const P_PRESENCE    = /RichText=\[([^\]]+)\]/;

function parseTimestamp(raw) {
  // 2026.03.08-19.14.26:313
  const [datePart, rest] = raw.split('-');
  const [y, mo, d] = datePart.split('.');
  const timeParts = rest.replace(':', '.').split('.');
  const [h, mi, s, ms] = timeParts;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms || '000'}Z`);
}

function fmt(date) {
  if (!date) return '??:??:??';
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function hms(date) {
  if (!date) return '--:--:--';
  const h = date.getUTCHours().toString().padStart(2,'0');
  const m = date.getUTCMinutes().toString().padStart(2,'0');
  const s = date.getUTCSeconds().toString().padStart(2,'0');
  return `${h}:${m}:${s}`;
}

function duration(a, b) {
  if (!a || !b) return '(in progress / cut off)';
  const s = Math.round((b - a) / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const CREATIVE_PLAYLISTS = ['Juno','VK_Play','Creative','DelMar','Playground'];
function isBR(playlist) {
  if (!playlist || playlist === 'Unknown') return false;
  return !CREATIVE_PLAYLISTS.some(k => playlist.includes(k));
}

function modeLabel(playlist) {
  if (!playlist) return '?';
  if (playlist.includes('ForbiddenFruit')) return 'Zero Build Duo (Reload)';
  if (playlist.includes('NoBuildBR_Solo')) return 'Zero Build Solo';
  if (playlist.includes('NoBuildBR_Duo'))  return 'Zero Build Duo';
  if (playlist.includes('NoBuildBR_Trio')) return 'Zero Build Trio';
  if (playlist.includes('NoBuildBR_Squad')) return 'Zero Build Squads';
  if (playlist.includes('DefaultSolo'))    return 'Build Solo';
  if (playlist.includes('DefaultDuo'))     return 'Build Duo';
  if (playlist.includes('DefaultSquad'))   return 'Build Squads';
  if (playlist.includes('Juno'))           return 'Creative (Juno)';
  if (playlist.includes('VK_Play'))        return 'Custom (VK/Super Pillars)';
  return playlist.replace('Playlist_','');
}

// ── Parse a single log file into raw events ───────────────────────────────────
async function parseLog(filePath) {
  const events = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines  = rl.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    const tsm = line.match(P_TIMESTAMP);
    const ts  = tsm ? parseTimestamp(tsm[1]) : null;
    let m;
    if ((m = line.match(P_LOGIN)))       events.push({ ts, type:'login',       player: m[1] });
    if ((m = line.match(P_MATCH_STATE))) events.push({ ts, type:'state',       from: m[1], to: m[2] });
    if ((m = line.match(P_KILL_SCORE)))  events.push({ ts, type:'kill_score',  score: parseInt(m[1]) });
    if ((m = line.match(P_PLAYLIST)))    events.push({ ts, type:'playlist',    name: m[1] });
    if ((m = line.match(P_PARTY_ADD)))   events.push({ ts, type:'party_add',   player: m[1] });
    if ((m = line.match(P_DEATH_LOCAL))) events.push({ ts, type:'death',       player: m[1] });
    if ((m = line.match(P_PRESENCE)))    events.push({ ts, type:'presence',    text: m[1] });
  }
  return events;
}

// ── Build match windows from sorted events ────────────────────────────────────
function buildMatches(events) {
  const matches = [];
  let localPlayer = 'Out4blood04';
  let party       = new Set([localPlayer]);
  let playlist    = null;
  let cur         = null;

  for (const ev of events) {
    // Track context
    if (ev.type === 'login')     { localPlayer = ev.player; party = new Set([localPlayer]); }
    if (ev.type === 'party_add') { party.add(ev.player); }
    if (ev.type === 'playlist')  { playlist = ev.name; }

    // Match lifecycle
    if (ev.type === 'state') {
      const { from, to } = ev;

      if (from === 'WaitingToStart' && to === 'InProgress') {
        if (cur) { cur.endTime = ev.ts; cur.cutOff = true; matches.push(cur); }
        cur = {
          startTime:   ev.ts,
          endTime:     null,
          cutOff:      false,
          playlist:    playlist || 'Unknown',
          party:       [...party].filter(p => p !== localPlayer),
          localPlayer,
          killEvents:  [],
          deaths:      [],
          presence:    [],
        };
      }

      if (to === 'LeavingMap' && cur) {
        cur.endTime = ev.ts;
        matches.push(cur);
        cur = null;
      }
    }

    // Accumulate in-match data
    if (cur) {
      if (ev.type === 'kill_score') cur.killEvents.push({ ts: ev.ts, score: ev.score });
      if (ev.type === 'death' && ev.player === localPlayer) cur.deaths.push(ev.ts);
      if (ev.type === 'presence') cur.presence.push(ev.text);
    }
  }

  // Unclosed last match
  if (cur) { cur.cutOff = true; matches.push(cur); }

  return matches;
}

// ── Estimate local player kills from interleaved OnRep_Kills data ─────────────
// Strategy: partition scores into monotonically-increasing runs.
// The longest consecutive run starting from 1 is most likely the local player.
function analyzeKills(killEvents) {
  if (!killEvents.length) return { localKills: 0, allScores: [], sequences: [] };

  const scores = killEvents.map(e => e.score);

  // Split into monotonic increasing sequences
  const seqs = [];
  let seq = [scores[0]];
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[i-1]) {
      seq.push(scores[i]);
    } else {
      seqs.push(seq);
      seq = [scores[i]];
    }
  }
  seqs.push(seq);

  // Best candidate: the sequence with the highest max that starts at or near 1
  const candidates = seqs.filter(s => s[0] <= 3); // starts at 1, 2, or 3
  const bestSeq = candidates.length
    ? candidates.reduce((a, b) => b[b.length-1] > a[a.length-1] ? b : a, candidates[0])
    : seqs.reduce((a,b) => b[b.length-1] > a[a.length-1] ? b : a, seqs[0]);

  const localKills = bestSeq ? bestSeq[bestSeq.length - 1] : 0;

  return { localKills, allScores: scores, sequences: seqs, bestSeq };
}

// ── Print the report ──────────────────────────────────────────────────────────
function printReport(matches) {
  const br = matches.filter(m => isBR(m.playlist));
  const creative = matches.filter(m => !isBR(m.playlist));

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     FORTNITE LOG SIMULATION — Full Session Playback          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── BR Matches
  console.log(`  ── BATTLE ROYALE MATCHES (${br.length}) ──────────────────────────────\n`);

  let totKills = 0, totDeaths = 0;

  br.forEach((m, i) => {
    const { localKills, allScores, sequences, bestSeq } = analyzeKills(m.killEvents);
    const kills  = localKills;
    const deaths = m.deaths.length;
    const kd     = deaths > 0 ? (kills / deaths).toFixed(2) : `${kills}.00`;
    totKills  += kills;
    totDeaths += deaths;

    const cutoff = m.cutOff ? ' [LOG CUT OFF - match still running]' : '';
    const dur    = m.cutOff ? `${duration(m.startTime, m.endTime)} (incomplete)` : duration(m.startTime, m.endTime);

    console.log(`  ┌─ MATCH ${String(i+1).padStart(2,'0')}  ${modeLabel(m.playlist)}`);
    console.log(`  │  Date:     ${fmt(m.startTime)}${cutoff}`);
    console.log(`  │  Duration: ${dur}`);
    console.log(`  │  Player:   ${m.localPlayer}`);

    const teammates = m.party.length > 0 ? m.party.join(', ') : '(solo queue)';
    console.log(`  │  Party:    ${teammates}`);

    console.log(`  │`);
    console.log(`  │  KILLS:  ${kills}   DEATHS: ${deaths}   K/D: ${kd}`);

    // Kill timeline
    if (allScores.length > 0) {
      // Show all kill score events grouped
      console.log(`  │`);
      console.log(`  │  Kill Score Events (all players, interleaved from server replication):`);
      const scoreStr = allScores.join(' → ');
      // wrap long strings
      const chunks = scoreStr.match(/.{1,70}/g) || [];
      chunks.forEach(c => console.log(`  │    ${c}`));

      if (sequences.length > 1) {
        console.log(`  │`);
        console.log(`  │  Distinct kill sequences detected: ${sequences.length}`);
        sequences.forEach((s, si) => {
          const tag = s === bestSeq ? ' ← likely Out4blood04' : '';
          console.log(`  │    Seq ${si+1}: [${s.join(', ')}] (max=${s[s.length-1]})${tag}`);
        });
      }

      // Kill timestamps for local player estimate
      if (bestSeq && bestSeq.length > 1) {
        console.log(`  │`);
        console.log(`  │  Kill timeline (estimated for ${m.localPlayer}):`);
        let seq = bestSeq.slice();
        let prev = 0;
        m.killEvents
          .filter(e => seq.includes(e.score) && e.score > prev)
          .forEach(e => {
            prev = e.score;
            const offset = Math.round((e.ts - m.startTime) / 1000);
            const om = Math.floor(offset / 60), os = offset % 60;
            console.log(`  │    Kill #${e.score}  at ${hms(e.ts)} UTC  (+${om}m ${os}s into match)`);
          });
      }
    }

    // Deaths
    if (m.deaths.length > 0) {
      console.log(`  │`);
      m.deaths.forEach((dt, j) => {
        const offset = Math.round((dt - m.startTime) / 1000);
        const om = Math.floor(offset / 60), os = offset % 60;
        console.log(`  │  ☠  Death at ${hms(dt)} UTC  (+${om}m ${os}s into match)`);
      });
    } else {
      console.log(`  │  (No death recorded — possible win or log ended first)`);
    }

    console.log(`  └────────────────────────────────────────────────────────────\n`);
  });

  // ── Session summary
  const sessionKD = totDeaths > 0 ? (totKills / totDeaths).toFixed(2) : `${totKills}.00`;
  console.log('  ── BR SESSION SUMMARY ────────────────────────────────────────\n');
  console.log(`  BR Matches:    ${br.length}`);
  console.log(`  Total Kills:   ${totKills}`);
  console.log(`  Total Deaths:  ${totDeaths}`);
  console.log(`  Session K/D:   ${sessionKD}`);

  // ── Party members
  const allParty = new Set();
  matches.forEach(m => m.party.forEach(p => allParty.add(p)));
  allParty.delete('Out4blood04');
  if (allParty.size > 0) {
    console.log(`\n  Party members seen across all sessions:`);
    [...allParty].forEach(p => console.log(`    • ${p}`));
  }

  // ── Creative/Custom breakdown
  if (creative.length > 0) {
    console.log(`\n  ── CREATIVE / CUSTOM GAMES (${creative.length}) ─────────────────────────\n`);
    creative.forEach((m, i) => {
      const { localKills, allScores } = analyzeKills(m.killEvents);
      const dur = m.cutOff ? `${duration(m.startTime, m.endTime)} (incomplete)` : duration(m.startTime, m.endTime);
      console.log(`  • ${String(i+1).padStart(2)} ${modeLabel(m.playlist).padEnd(28)} ${hms(m.startTime)}  ${dur}  ~${localKills} kills`);
    });
  }

  // ── All playlists
  const allPL = [...new Set(matches.map(m => m.playlist))];
  console.log(`\n  ── ALL PLAYLISTS DETECTED ────────────────────────────────────`);
  allPL.forEach(p => {
    const count = matches.filter(m => m.playlist === p).length;
    console.log(`    ${isBR(p) ? '[BR]      ' : '[Creative]'} ${p}  (${count} session${count>1?'s':''})`);
  });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  WHAT THE LOG CAN / CANNOT DETECT                           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  ✅  Match start / end                                       ║');
  console.log('║  ✅  Playlist / game mode                                    ║');
  console.log('║  ✅  Party members (by display name)                         ║');
  console.log('║  ✅  Local player death (SpectateAfterDeathViewTarget)        ║');
  console.log('║  ✅  Kill score increments — BUT without player names        ║');
  console.log('║  ⚠️   Local player kills: estimated via sequence analysis     ║');
  console.log('║  ❌  Squad member kills — NOT in log (no names on kill evts) ║');
  console.log('║  ❌  Victim names, weapon used, placement                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const logFiles = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('FortniteGame') && f.endsWith('.log'))
    .sort()
    .map(f => path.join(LOG_DIR, f));

  console.log(`\nScanning ${logFiles.length} log files from ${LOG_DIR}...\n`);
  logFiles.forEach(f => {
    const mb = (fs.statSync(f).size / 1024 / 1024).toFixed(1);
    console.log(`  ${path.basename(f).padEnd(55)} ${mb.padStart(6)} MB`);
  });
  console.log();

  let allEvents = [];
  for (const file of logFiles) {
    process.stdout.write(`  Parsing ${path.basename(file).padEnd(55)}`);
    const events = await parseLog(file);
    allEvents = allEvents.concat(events);
    console.log(`${events.length} events`);
  }

  allEvents.sort((a, b) => {
    if (!a.ts && !b.ts) return 0;
    if (!a.ts) return -1;
    if (!b.ts) return 1;
    return a.ts - b.ts;
  });

  const matches = buildMatches(allEvents);
  printReport(matches);
}

main().catch(console.error);
