const fs = require('fs');
const http = require('http');
const path = require('path');

const mockFotMob = require('./generator');

const port = Number(process.env.PORT || 80);
const siteRoot = path.join(__dirname, 'site');
let demoStarted = false;

mockFotMob.writeMockFotMobScenario();

const demoMatch = {
  id: '1001',
  label: 'Canada vs Mexico',
  path: '/matches/1001/canada-vs-mexico'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/') {
    return sendHtml(response, indexHtml());
  }

  if (url.pathname === `/demo/${demoMatch.id}`) {
    startDemo();
    response.writeHead(302, { Location: demoMatch.path });
    return response.end();
  }

  return serveMockPage(url.pathname, response);
});

server.listen(port, () => {
  console.log(`Mock FotMob listening on ${port}`);
});

function startDemo() {
  if (demoStarted) {
    return;
  }

  demoStarted = true;
  runDemo().catch((error) => console.error('Mock FotMob demo failed', error));
}

async function runDemo() {
  const steps = [
    { afterSeconds: 0, liveTime: "1'", score: '0-0', statsLevel: 0, includeSubstitutions: false, message: 'Kickoff' },
    { afterSeconds: 30, liveTime: "15'", score: '0-0', statsLevel: 1, includeSubstitutions: false, message: 'Touches and passes' },
    { afterSeconds: 60, liveTime: "30'", score: '0-0', statsLevel: 2, includeSubstitutions: false, message: 'Shots and saves' },
    { afterSeconds: 90, liveTime: "45'", score: '1-0', statsLevel: 3, includeSubstitutions: false, message: 'Goal' },
    { afterSeconds: 120, liveTime: "64'", score: '1-0', statsLevel: 4, includeSubstitutions: true, message: 'Substitution' },
    { afterSeconds: 150, liveTime: "80'", score: '1-0', statsLevel: 5, includeSubstitutions: true, message: 'Late stats' },
    { afterSeconds: 180, liveTime: null, score: '1-0', statsLevel: 5, includeSubstitutions: true, finished: true, message: 'Full time' }
  ];

  let elapsed = 0;
  for (const step of steps) {
    await sleep((step.afterSeconds - elapsed) * 1000);
    elapsed = step.afterSeconds;

    mockFotMob.setMockFotMobDemoStep({
      matchId: demoMatch.id,
      status: {
        started: true,
        finished: Boolean(step.finished),
        score: step.score,
        liveTime: step.liveTime
      },
      statsLevel: step.statsLevel,
      includeSubstitutions: step.includeSubstitutions
    });

    console.log(`[mock-fotmob-demo] ${step.afterSeconds}s ${step.message}`);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function serveMockPage(urlPath, response) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^\.\.(\/|$)/, '');
  const filePath = path.join(siteRoot, ...safePath.split('/').filter(Boolean));

  if (!filePath.startsWith(siteRoot) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('Not found');
  }

  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  return fs.createReadStream(filePath).pipe(response);
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(html);
}

function indexHtml() {
  const demoNote = demoStarted
    ? '<p>The demo has already started. Restart the containers to run it again.</p>'
    : '<p>Click the game to start the one-shot 3 minute demo.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mock FotMob</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; }
    a { color: #0b57d0; font-size: 1.2rem; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 20px; }
  </style>
</head>
<body>
  <h1>Mock FotMob</h1>
  ${demoNote}
  <div class="card">
    <a href="/demo/${demoMatch.id}">${demoMatch.label}</a>
    <p>This starts the scripted live match and opens the mock FotMob match page.</p>
  </div>
  <p><a href="/leagues/77/fixtures/world-cup">World Cup fixtures page</a></p>
</body>
</html>`;
}
