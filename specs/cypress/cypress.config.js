const { defineConfig } = require('cypress');
const mockFotMob = require('../mock-fotmob/generator');
const { createTestStateStore } = require('./test-state');

const testState = createTestStateStore();

module.exports = defineConfig({
  screenshotOnRunFailure: false,
  e2e: {
    baseUrl: 'http://localhost:8080',
    specPattern: '*.cy.js',
    supportFile: 'cypress/support/commands.js',
    setupNodeEvents(on) {
      on('task', {
        resetMockFotMob: mockFotMob.resetMockFotMob,
        setMockFotMobMatchStatus: mockFotMob.setMockFotMobMatchStatus,
        setMockFotMobLiveMatchStatus: mockFotMob.setMockFotMobLiveMatchStatus,
        writeMockFotMobScenario: mockFotMob.writeMockFotMobScenario,
        resetHomeMatches: () => testState.resetHomeMatches(),
        matchIsUpcoming: ({ matchId }) => testState.matchIsUpcoming(matchId),
        matchIsOngoing: ({ matchId, score }) => testState.matchIsOngoing(matchId, { score }),
        matchIsFinished: ({ matchId, score }) => testState.matchIsFinished(matchId, { score }),
        clearDraft: ({ matchId }) => testState.clearDraft(matchId),
        openDraft: ({ matchId, joinedUsers }) => testState.openDraft(matchId, { joinedUsers }),
        startedDraft: ({ matchId, joinedUsers, draftOrder, draftTurnOrder, picks }) => testState.startedDraft(matchId, { joinedUsers, draftOrder, draftTurnOrder, picks }),
        completedDraft: ({ matchId, joinedUsers, draftOrder, draftTurnOrder, picks }) => testState.completedDraft(matchId, { joinedUsers, draftOrder, draftTurnOrder, picks }),
        clearCompletedLiveMatch: ({ matchId }) => testState.clearCompletedLiveMatch(matchId),
        getCompletedLiveMatch: ({ matchId }) => testState.getCompletedLiveMatch(matchId),
        setCompletedLiveMatch: ({ matchId, completed }) => testState.setCompletedLiveMatch(matchId, completed)
      });
    }
  }
});
