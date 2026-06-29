Cypress.Commands.add('testGet', (testId, options) => cy.get(`[data-test="${testId}"]`, options));

Cypress.Commands.add('findMatchCard', (matchLabel) => {
  const cardSelector = '[data-test="match-card"]';

  return cy.contains(cardSelector, matchLabel);
});

Cypress.Commands.add('arrangeBrowserTime', (timestamp) => {
  cy.clock(timestamp, ['Date']);
});

Cypress.Commands.add('visitWithWorkingClipboard', (url) => {
  cy.visit(url, {
    onBeforeLoad(win) {
      Object.defineProperty(win.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText() {
            return Promise.resolve();
          }
        }
      });
    }
  });
});

Cypress.Commands.add('visitWithFailingWebSocket', (url) => {
  cy.visit(url, {
    onBeforeLoad(win) {
      class FailingWebSocket extends win.EventTarget {
        constructor() {
          super();
          setTimeout(() => this.dispatchEvent(new win.Event('error')), 0);
        }

        close() {}

        send() {}
      }

      win.WebSocket = FailingWebSocket;
    }
  });
});

Cypress.env('mockMatches', {
  confirmedLineups: 1001,
  noLineups: 1002,
  predictedLineups: 1003,
  shortBench: 1004
});

Cypress.Commands.add('resetTestState', () => {
  cy.task('resetTestState');
});

Cypress.Commands.add('arrangeUpcomingMatch', (matchId) => {
  cy.task('setMockFotMobMatchStatus', { matchId, status: { started: false, finished: false, score: null } });
  cy.task('matchIsUpcoming', { matchId });
});

Cypress.Commands.add('arrangeOngoingMatch', (matchId, options = {}) => {
  const status = { started: true, finished: false, score: options.score ?? null };

  cy.task('setMockFotMobMatchStatus', { matchId, status });
  cy.task('matchIsOngoing', { matchId, score: status.score });
});

Cypress.Commands.add('arrangeFinishedMatch', (matchId, options = {}) => {
  const status = { started: true, finished: true, score: options.score ?? null };

  cy.task('setMockFotMobMatchStatus', { matchId, status });
  cy.task('matchIsFinished', { matchId, score: status.score });
});

Cypress.Commands.add('setScraperLiveMatchStatus', (matchId, status) => {
  cy.task('setMockFotMobLiveMatchStatus', { matchId, status });
});

Cypress.Commands.add('arrangeNoDraft', (matchId) => {
  cy.task('clearDraft', { matchId });
});

Cypress.Commands.add('arrangeOpenDraft', (matchId, options = {}) => {
  cy.task('openDraft', {
    matchId,
    joinedUsers: options.joinedUsers ?? ['Alice']
  });
});

Cypress.Commands.add('arrangeStartedDraft', (matchId, options = {}) => {
  const draftOrder = options.draftOrder ?? ['Alice', 'Bob'];

  cy.task('startedDraft', {
    matchId,
    joinedUsers: options.joinedUsers ?? draftOrder,
    draftOrder,
    draftTurnOrder: options.draftTurnOrder ?? null,
    picks: options.picks ?? []
  });
});

Cypress.Commands.add('arrangeCompletedDraft', (matchId, options) => {
  const draftOrder = options.draftOrder ?? ['Alice', 'Bob'];

  cy.task('completedDraft', {
    matchId,
    joinedUsers: options.joinedUsers ?? draftOrder,
    draftOrder,
    draftTurnOrder: options.draftTurnOrder ?? null,
    picks: options.picks
  });
});

Cypress.Commands.add('clearCompletedLiveMatch', (matchId) => {
  cy.task('clearCompletedLiveMatch', { matchId });
});

Cypress.Commands.add('getCompletedLiveMatch', (matchId) => cy.task('getCompletedLiveMatch', { matchId }).then((completed) => {
  expect(completed, `completed live match ${matchId}`).to.exist;
  return completed;
}));

Cypress.Commands.add('getCompletedLiveMatchOrNull', (matchId) => cy.task('getCompletedLiveMatch', { matchId }));

Cypress.Commands.add('setCompletedLiveMatch', (matchId, completed) => {
  cy.task('setCompletedLiveMatch', { matchId, completed });
});

Cypress.Commands.add('getMockMatch', (matchId) => cy.request('/api/matches').then(({ body }) => {
  const match = body.find((candidate) => candidate.id === matchId);

  expect(match, `mock match ${matchId}`).to.exist;
  return match;
}));

Cypress.Commands.add('getMockMatches', () => cy.request('/api/matches').then(({ body }) => body));

Cypress.Commands.add('getDraftLineups', (matchId, passkey) => cy.request(`/api/drafts/${matchId}?passkey=${passkey}`).then(({ body: draft }) => {
  const lineups = draft.match?.lineups ?? [];

  return {
    lineups,
    homeStarters: lineups[0]?.starters?.map((player) => player.name) ?? [],
    homeBench: lineups[0]?.bench?.map((player) => player.name) ?? [],
    awayStarters: lineups[1]?.starters?.map((player) => player.name) ?? [],
    awayBench: lineups[1]?.bench?.map((player) => player.name) ?? []
  };
}));

Cypress.Commands.add('arrangeDraftPick', (matchId, passkey, playerName) => {
  cy.request('POST', `/api/drafts/${matchId}/picks`, { passkey, playerName })
    .its('status')
    .should('equal', 200);
});

Cypress.Commands.add('getDraftForSetup', (matchId, passkey) => cy.request(`/api/drafts/${matchId}?passkey=${passkey}`).then(({ body }) => body));

Cypress.Commands.add('assertLiveMatchUnavailable', (matchId, passkey) => {
  cy.request({
    url: `/api/matches/${matchId}/live?passkey=${passkey}`,
    failOnStatusCode: false
  }).its('status').should('equal', 400);
});
