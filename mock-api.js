// mock-api.js — local stand-in for fortnite-api.com/v2
// Run with: node mock-api.js
// Then set FORTNITE_API_KEY=mock in .env and restart the dev server.

const http = require('http');

const fakeStats = {
  data: {
    account: { id: 'abc123', name: 'Out4blood04' },
    battlePass: { level: 87, progress: 64 },
    stats: {
      all: {
        overall: { wins: 142, kills: 4830, kd: 3.21, matches: 1647, winRate: 8.6,
                   killsPerMatch: 2.93, minutesPlayed: 48200, deaths: 1505,
                   score: 0, scorePerMatch: 0, lastModified: Date.now() },
        solo:    { wins: 58,  kills: 1920, kd: 2.85, matches: 732,  winRate: 7.9,
                   killsPerMatch: 2.62, minutesPlayed: 0, deaths: 674,  score: 0, scorePerMatch: 0 },
        duo:     { wins: 41,  kills: 1340, kd: 3.44, matches: 430,  winRate: 9.5,
                   killsPerMatch: 3.11, minutesPlayed: 0, deaths: 389,  score: 0, scorePerMatch: 0 },
        squad:   { wins: 43,  kills: 1570, kd: 3.52, matches: 485,  winRate: 8.8,
                   killsPerMatch: 3.24, minutesPlayed: 0, deaths: 446,  score: 0, scorePerMatch: 0 },
      }
    }
  }
};

let killOffset = 0;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url.startsWith('/v2/stats/br/v2')) {
    // Simulate a new kill every other poll to show session tracking
    killOffset++;
    const live = JSON.parse(JSON.stringify(fakeStats));
    live.data.stats.all.overall.kills += killOffset;
    live.data.stats.all.overall.matches += Math.floor(killOffset / 3);
    live.data.stats.all.overall.lastModified = Date.now();
    res.writeHead(200);
    res.end(JSON.stringify(live));
    console.log(`[mock-api] Served stats — kills: ${live.data.stats.all.overall.kills}`);
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`\n[mock-api] Running at http://localhost:${PORT}`);
  console.log('[mock-api] Simulating Out4blood04 stats — kills increment each poll\n');
  console.log('To use: set these in your .env and restart the overlay server:\n');
  console.log('  FORTNITE_API_KEY=mock');
  console.log('  DEFAULT_USERNAME=Out4blood04\n');
});
