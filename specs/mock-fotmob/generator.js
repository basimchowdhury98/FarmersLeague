const fs = require('fs');
const path = require('path');

const siteRoot = path.join(__dirname, 'site');

const defaultStatuses = {
  1001: { started: false, finished: false, score: null },
  1002: { started: false, finished: false, score: null },
  1003: { started: false, finished: false, score: null },
  1004: { started: false, finished: false, score: null }
};

const state = {
  statuses: { ...defaultStatuses },
  liveStatuses: {},
  demoSteps: {}
};

const matches = [
  match('1001', 'Canada', 'CAN', '50', 'Mexico', 'MEX', '42', 30, '/matches/1001/canada-vs-mexico'),
  match('1002', 'Brazil', 'BRA', '60', 'Japan', 'JPN', '70', 60, '/matches/1002/brazil-vs-japan'),
  match('1003', 'Argentina', 'ARG', '80', 'Algeria', 'ALG', '90', 120, '/matches/1003/argentina-vs-algeria'),
  match('1004', 'Iraq', 'IRQ', '100', 'Norway', 'NOR', '110', 30, '/matches/1004/iraq-vs-norway')
];

function match(id, homeName, homeShortName, homeId, awayName, awayShortName, awayId, minutesFromNow, pageUrl) {
  return {
    id,
    home: { id: homeId, name: homeName, shortName: homeShortName },
    away: { id: awayId, name: awayName, shortName: awayShortName },
    group: 'Group A',
    round: '1',
    roundName: 'Group stage',
    minutesFromNow,
    pageUrl
  };
}

function resetMockFotMob() {
  state.statuses = { ...defaultStatuses };
  state.liveStatuses = {};
  state.demoSteps = {};
  writeMockFotMobScenario();
  return null;
}

function setMockFotMobMatchStatus({ matchId, status }) {
  state.statuses[String(matchId)] = normalizeStatus(status);
  writeMockFotMobScenario();
  return null;
}

function setMockFotMobLiveMatchStatus({ matchId, status }) {
  state.liveStatuses[String(matchId)] = normalizeStatus(status);
  writeMockFotMobScenario();
  return null;
}

function setMockFotMobDemoStep({ matchId, status, statsLevel = null, includeSubstitutions = false }) {
  const id = String(matchId);
  const normalizedStatus = normalizeStatus(status);

  state.statuses[id] = normalizedStatus;
  state.liveStatuses[id] = normalizedStatus;
  state.demoSteps[id] = { statsLevel, includeSubstitutions };
  writeMockFotMobScenario();
  return null;
}

function writeMockFotMobScenario() {
  fs.mkdirSync(siteRoot, { recursive: true });
  for (const entry of fs.readdirSync(siteRoot)) {
    fs.rmSync(path.join(siteRoot, entry), { recursive: true, force: true });
  }

  writePage('/leagues/77/fixtures/world-cup', fixturesNextData());

  for (const fixture of matches) {
    writePage(fixture.pageUrl, matchNextData(fixture));
  }

  return null;
}

function normalizeStatus(status = {}) {
  return {
    started: Boolean(status.started),
    finished: Boolean(status.finished),
    score: status.score ?? null,
    liveTime: status.liveTime ?? null
  };
}

function fixturesNextData() {
  return {
    props: {
      pageProps: {
        fixtures: {
          allMatches: matches.map((fixture) => ({
            id: fixture.id,
            home: fixture.home,
            away: fixture.away,
            group: fixture.group,
            round: fixture.round,
            roundName: fixture.roundName,
            pageUrl: fixture.pageUrl,
            status: statusJson(fixture, state.statuses[fixture.id])
          }))
        }
      }
    },
    page: '/leagues/[id]/fixtures/[name]',
    query: { id: '77', name: 'world-cup', group: 'by-date', page: '0' },
    buildId: 'farmersleague-mock-fotmob',
    isFallback: false,
    gssp: true,
    scriptLoader: []
  };
}

function matchNextData(fixture) {
  const liveStatus = state.liveStatuses[fixture.id] ?? state.statuses[fixture.id];
  const demoStep = state.demoSteps[fixture.id] ?? null;

  return {
    props: {
      pageProps: {
        header: {
          id: fixture.id,
          teams: [fixture.home, fixture.away],
          status: statusJson(fixture, liveStatus)
        },
        content: {
          lineup: lineupFor(fixture.id),
          playerStats: playerStatsFor(fixture.id, demoStep?.statsLevel),
          matchFacts: {
            events: {
              events: substitutionsFor(fixture.id, demoStep?.includeSubstitutions)
            }
          }
        }
      }
    },
    page: '/matches/[matchId]/[matchName]',
    query: { matchId: fixture.id },
    buildId: 'farmersleague-mock-fotmob',
    isFallback: false,
    gssp: true,
    scriptLoader: []
  };
}

function statusJson(fixture, status = {}) {
  const normalized = normalizeStatus(status);
  return {
    utcTime: new Date(Date.now() + fixture.minutesFromNow * 60 * 1000).toISOString(),
    started: normalized.started,
    finished: normalized.finished,
    scoreStr: normalized.score,
    reason: normalized.finished
      ? { short: 'FT', shortKey: 'fulltime_short', long: 'Full-Time', longKey: 'finished' }
      : { short: null, shortKey: null, long: 'Mock FotMob fixture', longKey: null },
    liveTime: normalized.liveTime ?? (normalized.started && !normalized.finished ? '45\'' : null)
  };
}

function lineupFor(matchId) {
  if (matchId === '1002') {
    return null;
  }

  if (matchId === '1003') {
    return lineup(matchId, 'predicted', 'mock-fotmob', team('80', 'Argentina', canadaStarters(), canadaBench()), team('90', 'Algeria', mexicoStarters(), mexicoBench()));
  }

  if (matchId === '1004') {
    return lineup(matchId, 'standard', 'mock-fotmob', team('100', 'Iraq', canadaStarters(), canadaBench().slice(0, 5)), team('110', 'Norway', mexicoStarters(), mexicoBench().slice(0, 5)));
  }

  return lineup(matchId, 'standard', 'mock-fotmob', team('50', 'Canada', canadaStarters(), canadaBench()), team('42', 'Mexico', mexicoStarters(), mexicoBench()));
}

function lineup(matchId, lineupType, source, homeTeam, awayTeam) {
  return { matchId, lineupType, source, homeTeam, awayTeam };
}

function team(id, name, starters, subs) {
  return { id, name, formation: '4-3-3', starters, subs };
}

function canadaStarters() {
  return [
    player('can-1', 'Dayne St. Clair', 1, 0, 1, 1),
    player('can-2', 'Alistair Johnston', 2, 2, 2, 1),
    player('can-4', 'Kamal Miller', 4, 2, 2, 2),
    player('can-19', 'Alphonso Davies', 19, 2, 2, 3),
    player('can-8', 'Ismael Kone', 8, 3, 3, 1),
    player('can-21', 'Jonathan Osorio', 21, 3, 3, 2),
    player('can-15', 'Nathan Saliba', 15, 3, 3, 3),
    player('can-11', 'Tajon Buchanan', 11, 4, 4, 1),
    player('can-10', 'Jonathan David', 10, 4, 4, 2),
    player('can-17', 'Cyle Larin', 17, 4, 4, 3),
    player('can-7', 'Stephen Eustaquio', 7, 2, 5, 2)
  ];
}

function mexicoStarters() {
  return [
    player('mex-1', 'Raul Rangel', 1, 0, 1, 1),
    player('mex-2', 'Israel Reyes', 2, 2, 2, 1),
    player('mex-3', 'Cesar Montes', 3, 2, 2, 2),
    player('mex-5', 'Johan Vasquez', 5, 2, 2, 3),
    player('mex-23', 'Jesus Gallardo', 23, 2, 3, 1),
    player('mex-18', 'Erik Lira', 18, 3, 3, 2),
    player('mex-8', 'Orbelin Pineda', 8, 3, 3, 3),
    player('mex-14', 'Brian Gutierrez', 14, 3, 4, 1),
    player('mex-9', 'Julian Quinones', 9, 4, 4, 2),
    player('mex-11', 'Raul Jimenez', 11, 4, 4, 3),
    player('mex-19', 'Roberto Alvarado', 19, 4, 5, 2)
  ];
}

function canadaBench() {
  return Array.from({ length: 15 }, (_, index) => player(`can-sub-${index + 1}`, `Canada Substitute ${index + 1}`, 31 + index, null));
}

function mexicoBench() {
  return Array.from({ length: 15 }, (_, index) => player(`mex-sub-${index + 1}`, `Mexico Substitute ${index + 1}`, 41 + index, null));
}

function player(id, name, shirtNumber, positionId, row = null, column = null) {
  const base = {
    id,
    name,
    firstName: null,
    lastName: null,
    shirtNumber,
    positionId,
    usualPlayingPositionId: positionId,
    isCaptain: false
  };

  if (row === null || column === null) {
    return base;
  }

  return {
    ...base,
    horizontalLayout: { x: column, y: row, height: 1, width: 1 },
    verticalLayout: { x: column, y: row, height: 1, width: 1 }
  };
}

function substitutionsFor(matchId, includeSubstitutions = true) {
  if (matchId !== '1001' || !includeSubstitutions) {
    return [];
  }

  return [
    substitution(64, true, 'can-sub-1', 'Canada Substitute 1', 'can-2', 'Alistair Johnston'),
    substitution(72, false, 'mex-sub-1', 'Mexico Substitute 1', 'mex-2', 'Israel Reyes'),
    substitution(79, true, 'can-sub-2', 'Canada Substitute 2', 'can-10', 'Jonathan David')
  ];
}

function substitution(time, isHome, playerOnId, playerOnName, playerOffId, playerOffName) {
  return {
    type: 'Substitution',
    time,
    timeStr: String(time),
    isHome,
    injuredPlayerOut: false,
    swap: [
      { id: playerOnId, name: playerOnName },
      { id: playerOffId, name: playerOffName }
    ]
  };
}

function playerStatsFor(matchId, statsLevel = null) {
  if (matchId !== '1001') {
    return {};
  }

  const allPlayers = [
    ...canadaStarters().map((p) => ({ ...p, teamId: '50', teamName: 'Canada' })),
    ...canadaBench().map((p) => ({ ...p, teamId: '50', teamName: 'Canada' })),
    ...mexicoStarters().map((p) => ({ ...p, teamId: '42', teamName: 'Mexico' })),
    ...mexicoBench().map((p) => ({ ...p, teamId: '42', teamName: 'Mexico' }))
  ];

  return Object.fromEntries(allPlayers.map((p, index) => [
    p.id,
    statsLevel === null ? playerStatsPlayer(p, index) : demoPlayerStatsPlayer(p, index, statsLevel)
  ]));
}

function demoPlayerStatsPlayer(playerValue, index, statsLevel) {
  const level = Math.max(0, Math.min(Number(statsLevel) || 0, 5));
  const isGoalkeeper = playerValue.positionId === 0;
  const isSubstitute = playerValue.positionId === null;
  const hasPlayed = !isSubstitute || (level >= 4 && playerValue.name === 'Canada Substitute 1');
  const goals = level >= 3 && playerValue.name === 'Jonathan David' ? 1 : 0;
  const assists = level >= 3 && playerValue.name === 'Tajon Buchanan' ? 1 : 0;
  const saves = isGoalkeeper && hasPlayed ? Math.min(level, 3) : 0;
  const passes = hasPlayed ? level * 7 + (index % 4) : 0;
  const shots = hasPlayed && level >= 2 ? goals + 1 : 0;
  const active = hasPlayed ? level : 0;

  return {
    id: playerValue.id,
    optaId: null,
    name: playerValue.name,
    teamId: playerValue.teamId,
    teamName: playerValue.teamName,
    shirtNumber: String(playerValue.shirtNumber),
    isGoalkeeper,
    stats: [
      statGroup('attack', {
        Goals: stat('goals', goals),
        'Expected goals': stat('expected_goals', goals ? 0.72 : level * 0.03),
        'Expected goals on target': stat('expected_goals_on_target_variant', goals ? 0.64 : level * 0.02),
        'Total shots': stat('total_shots', shots),
        'Shots on target': stat('ShotsOnTarget', goals ? 2 : level >= 2 && hasPlayed ? 1 : 0),
        'Touches in opposition box': stat('touches_opp_box', hasPlayed ? level : 0),
        'Successful dribbles': stat('dribbles_succeeded', hasPlayed ? level % 3 : 0),
        'Big chances missed': stat('big_chance_missed_title', 0)
      }),
      statGroup('passes', {
        Touches: stat('touches', passes + active),
        'Accurate passes': stat('accurate_passes', passes),
        Assists: stat('assists', assists),
        'Expected assists': stat('expected_assists', assists ? 0.5 : level * 0.02),
        'Chances created': stat('chances_created', assists + (hasPlayed && level >= 2 ? 1 : 0)),
        'Passes into final third': stat('passes_into_final_third', hasPlayed ? Math.max(0, level - 1) : 0),
        'Accurate crosses': stat('accurate_crosses', hasPlayed && level >= 3 ? 1 : 0),
        'Accurate long balls': stat('long_balls_accurate', hasPlayed ? Math.max(0, level - 2) : 0)
      }),
      statGroup('defense', {
        'Defensive actions': stat('defensive_actions', active),
        Tackles: stat('matchstats.headers.tackles', isGoalkeeper || !hasPlayed ? 0 : Math.min(level, 2)),
        Interceptions: stat('interceptions', hasPlayed && level >= 2 ? 1 : 0),
        'Shot blocks': stat('shot_blocks', hasPlayed && level >= 4 ? 1 : 0),
        Recoveries: stat('recoveries', active + (hasPlayed ? 1 : 0)),
        Clearances: stat('clearances', isGoalkeeper || !hasPlayed ? 0 : Math.min(level, 3)),
        'Headed clearances': stat('headed_clearance', hasPlayed && level >= 3 ? 1 : 0),
        'Dribbled past': stat('dribbled_past', 0)
      }),
      statGroup('duels', {
        'Duels won': stat('duel_won', hasPlayed ? Math.min(level, 3) : 0),
        'Duels lost': stat('duel_lost', hasPlayed && level >= 2 ? 1 : 0),
        'Ground duels won': stat('ground_duels_won', hasPlayed ? Math.min(level, 2) : 0),
        'Aerial duels won': stat('aerials_won', hasPlayed && level >= 3 ? 1 : 0),
        Fouls: stat('fouls', hasPlayed && level >= 3 ? 1 : 0),
        'Was fouled': stat('was_fouled', hasPlayed && level >= 2 ? 1 : 0)
      }),
      ...(isGoalkeeper ? [statGroup('goalkeeping', {
        Saves: stat('saves', saves),
        'Goals conceded': stat('goals_conceded', level >= 5 ? 0 : 0),
        'Expected goals on target faced': stat('expected_goals_on_target_faced', level * 0.2),
        'Goals prevented': stat('goals_prevented', level * 0.1),
        'Keeper sweeper': stat('keeper_sweeper', level >= 2 ? 1 : 0),
        'High claims': stat('keeper_high_claim', level >= 3 ? 1 : 0)
      })] : [])
    ]
  };
}

function playerStatsPlayer(playerValue, index) {
  const isGoalkeeper = playerValue.positionId === 0;
  const isSubstitute = playerValue.positionId === null;

  if (playerValue.name === 'Canada Substitute 5') {
    return zeroScoringPlayerStats(playerValue, isGoalkeeper);
  }

  const active = isSubstitute ? 0 : 5;
  const scoringIndex = isSubstitute ? 0 : index;
  const goals = playerValue.name === 'Jonathan David' ? 1 : 0;
  const assists = playerValue.name === 'Tajon Buchanan' ? 1 : 0;
  const saves = isGoalkeeper && !isSubstitute ? 2 : 0;
  const passes = isGoalkeeper ? 18 : 35 + (index % 8);

  return {
    id: playerValue.id,
    optaId: null,
    name: playerValue.name,
    teamId: playerValue.teamId,
    teamName: playerValue.teamName,
    shirtNumber: String(playerValue.shirtNumber),
    isGoalkeeper,
    stats: [
      statGroup('attack', {
        Goals: stat('goals', goals),
        'Expected goals': stat('expected_goals', goals ? 0.72 : 0.12),
        'Expected goals on target': stat('expected_goals_on_target_variant', goals ? 0.64 : 0.08),
        'Total shots': stat('total_shots', active + goals),
        'Shots on target': stat('ShotsOnTarget', isSubstitute ? 0 : goals ? 2 : 1),
        'Touches in opposition box': stat('touches_opp_box', active + (scoringIndex % 4)),
        'Successful dribbles': stat('dribbles_succeeded', scoringIndex % 3),
        'Big chances missed': stat('big_chance_missed_title', 0)
      }),
      statGroup('passes', {
        Touches: stat('touches', passes + 10),
        'Accurate passes': stat('accurate_passes', passes),
        Assists: stat('assists', assists),
        'Expected assists': stat('expected_assists', assists ? 0.5 : 0.05),
        'Chances created': stat('chances_created', isSubstitute ? 0 : assists + 1),
        'Passes into final third': stat('passes_into_final_third', isGoalkeeper ? 1 : 4),
        'Accurate crosses': stat('accurate_crosses', isGoalkeeper || isSubstitute ? 0 : scoringIndex % 2),
        'Accurate long balls': stat('long_balls_accurate', isSubstitute ? 0 : isGoalkeeper ? 4 : 2)
      }),
      statGroup('defense', {
        'Defensive actions': stat('defensive_actions', active + 1),
        Tackles: stat('matchstats.headers.tackles', isGoalkeeper ? 0 : 2),
        Interceptions: stat('interceptions', isGoalkeeper ? 0 : 1),
        'Shot blocks': stat('shot_blocks', isGoalkeeper || isSubstitute ? 0 : scoringIndex % 2),
        Recoveries: stat('recoveries', isSubstitute ? 0 : active + 2),
        Clearances: stat('clearances', isSubstitute ? 0 : isGoalkeeper ? 1 : 3),
        'Headed clearances': stat('headed_clearance', isGoalkeeper || isSubstitute ? 0 : 1),
        'Dribbled past': stat('dribbled_past', 0)
      }),
      statGroup('duels', {
        'Duels won': stat('duel_won', isGoalkeeper || isSubstitute ? 0 : 3),
        'Duels lost': stat('duel_lost', isGoalkeeper ? 0 : 1),
        'Ground duels won': stat('ground_duels_won', isGoalkeeper || isSubstitute ? 0 : 2),
        'Aerial duels won': stat('aerials_won', isGoalkeeper || isSubstitute ? 0 : 1),
        Fouls: stat('fouls', 1),
        'Was fouled': stat('was_fouled', 1)
      }),
      ...(isGoalkeeper ? [statGroup('goalkeeping', {
        Saves: stat('saves', saves),
        'Goals conceded': stat('goals_conceded', 1),
        'Expected goals on target faced': stat('expected_goals_on_target_faced', 1.2),
        'Goals prevented': stat('goals_prevented', 0.4),
        'Keeper sweeper': stat('keeper_sweeper', 1),
        'High claims': stat('keeper_high_claim', 1)
      })] : [])
    ]
  };
}

function zeroScoringPlayerStats(playerValue, isGoalkeeper) {
  return {
    id: playerValue.id,
    optaId: null,
    name: playerValue.name,
    teamId: playerValue.teamId,
    teamName: playerValue.teamName,
    shirtNumber: String(playerValue.shirtNumber),
    isGoalkeeper,
    stats: [
      statGroup('passes', {
        Touches: stat('touches', 14),
        'Accurate passes': stat('accurate_passes', 9),
        'Expected assists': stat('expected_assists', 0.03)
      }),
      statGroup('duels', {
        Fouls: stat('fouls', 1),
        'Was fouled': stat('was_fouled', 1)
      })
    ]
  };
}

function statGroup(key, stats) {
  return { key, stats };
}

function stat(key, value) {
  return { key, stat: { value, total: null, type: null } };
}

function writePage(urlPath, nextData) {
  const outputPath = path.join(siteRoot, ...urlPath.split('/').filter(Boolean));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderFotMobHtml(nextData));
}

function renderFotMobHtml(nextData) {
  const json = JSON.stringify(nextData).replace(/</g, '\\u003c');

  return `<!DOCTYPE html><html lang="en" dir="ltr"><head><meta name="apple-itunes-app" content="app-id=488575683"/><link rel="alternate" href="android-app://com.mobilefootie.wc2010/http"/><link rel="apple-touch-icon" href="/img/android-icon-192x192.png"/><link rel="manifest" href="/manifest.json"/><link rel="icon" type="image/x-icon" href="/favicon.ico"/><link rel="icon" type="image/png" href="/favicon.png"/><meta name="apple-mobile-web-app-title" content="FotMob"/><meta name="color-scheme" content="dark light"/><meta name="robots" content="all"/><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0"/><meta property="og:site_name" content="FotMob"/><link rel="canonical" href="https://www.fotmob.com/leagues/77/fixtures/world-cup"/><title>FIFA World Cup fixtures, results and live scores 2026</title><meta name="title" content="FIFA World Cup fixtures, results and live scores 2026"/><meta name="description" content="All FIFA World Cup match results and upcoming fixtures for 2026. Sort by date, round, club or group. Live scores and results updated every matchday."/><meta name="next-head-count" content="23"/><script>window['gtag_enable_tcf_support']=true;window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}</script></head><body><div id="__next"><main><h1>FotMob</h1></main></div><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`;
}

module.exports = {
  resetMockFotMob,
  setMockFotMobMatchStatus,
  setMockFotMobLiveMatchStatus,
  setMockFotMobDemoStep,
  writeMockFotMobScenario
};

if (require.main === module) {
  resetMockFotMob();
}
