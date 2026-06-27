Cypress.Commands.add('testGet', (testId, options) => cy.get(`[data-test="${testId}"]`, options));

Cypress.Commands.add('findMatchCard', (matchLabel) => {
  const cardSelector = '[data-test="match-card"]';
  const tabsToSearch = ['today-matches-tab', 'upcoming-matches-tab', 'past-matches-tab'];

  const findInVisibleTab = () => cy.get('body').then(($body) => {
    const matchingCard = $body.find(cardSelector).filter((_, card) => card.innerText.includes(matchLabel));

    if (matchingCard.length > 0) {
      return cy.contains(cardSelector, matchLabel);
    }

    const nextTab = tabsToSearch.shift();

    if (!nextTab) {
      return cy.contains(cardSelector, matchLabel);
    }

    return cy.testGet(nextTab).click().then(findInVisibleTab);
  });

  return findInVisibleTab();
});

Cypress.env('mockMatches', {
  confirmedLineups: 1001,
  noLineups: 1002,
  predictedLineups: 1003,
  shortBench: 1004
});

Cypress.Commands.add('resetScraperMatches', () => {
  cy.task('resetMockFotMob');
  cy.task('resetHomeMatches');
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
