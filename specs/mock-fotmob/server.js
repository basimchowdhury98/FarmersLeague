const http = require('http');

const mockFotMob = require('./generator');

const port = Number(process.env.PORT || 80);
const demoDisabled = process.env.DISABLE_MOCK_FOTMOB_DEMO === 'true';
let demoStarted = false;

const demoMatch = {
  id: '1001',
  label: 'Canada vs Mexico',
  path: '/matches/1001/canada-vs-mexico'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/__admin/')) {
    return serveAdminRequest(request, response, url);
  }

  if (url.pathname === '/') {
    return sendHtml(response, indexHtml());
  }

  if (url.pathname === `/demo/${demoMatch.id}`) {
    if (demoDisabled) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Demo disabled');
    }

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
  const html = mockFotMob.getMockFotMobPage(urlPath);

  if (html === null) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('Not found');
  }

  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  return response.end(html);
}

function serveAdminRequest(request, response, url) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('Method not allowed');
  }

  readJsonBody(request)
    .then((body) => handleAdminRequest(url.pathname, body))
    .then((result) => sendJson(response, result ?? null))
    .catch((error) => {
      const status = error.statusCode ?? 500;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error.message }));
    });
}

function handleAdminRequest(pathname, body) {
  if (pathname === '/__admin/reset') {
    demoStarted = false;
    return mockFotMob.resetMockFotMob();
  }

  const match = pathname.match(/^\/__admin\/matches\/([^/]+)\/(status|live-status|demo-step)$/);
  if (!match) {
    const error = new Error('Admin route not found');
    error.statusCode = 404;
    throw error;
  }

  const [, matchId, action] = match;

  if (action === 'status') {
    return mockFotMob.setMockFotMobMatchStatus({ matchId, status: body.status });
  }

  if (action === 'live-status') {
    return mockFotMob.setMockFotMobLiveMatchStatus({ matchId, status: body.status });
  }

  return mockFotMob.setMockFotMobDemoStep({
    matchId,
    status: body.status,
    statsLevel: body.statsLevel,
    includeSubstitutions: body.includeSubstitutions
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      if (body.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, value) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(html);
}

function indexHtml() {
  const demoNote = demoDisabled
    ? '<p>The demo is disabled in this environment.</p>'
    : demoStarted
    ? '<p>The demo has already started. Restart the containers to run it again.</p>'
    : '<p>Click the game to start the one-shot 3 minute demo.</p>';
  const demoLink = demoDisabled
    ? ''
    : `<a href="/demo/${demoMatch.id}">${demoMatch.label}</a><p>This starts the scripted live match and opens the mock FotMob match page.</p>`;

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
    ${demoLink}
  </div>
  <p><a href="/leagues/77/fixtures/world-cup">World Cup fixtures page</a></p>
</body>
</html>`;
}
