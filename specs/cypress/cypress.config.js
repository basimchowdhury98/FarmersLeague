const { defineConfig } = require('cypress');
const { createTestStateStore } = require('./test-state');

const testState = createTestStateStore();
const mockFotMobAdminUrl = process.env.MOCK_FOTMOB_ADMIN_URL ?? 'http://localhost:8081';

module.exports = defineConfig({
  screenshotOnRunFailure: false,
  e2e: {
    baseUrl: 'http://localhost:8080',
    specPattern: '*.cy.js',
    supportFile: 'cypress/support/commands.js',
    setupNodeEvents(on) {
      on('task', {
        resetMockFotMob: () => postMockFotMobAdmin('/__admin/reset'),
        resetTestState: async () => {
          await postMockFotMobAdmin('/__admin/reset');
          await testState.resetTestState();
          return null;
        },
        setMockFotMobMatchStatus: ({ matchId, status }) => postMockFotMobAdmin(`/__admin/matches/${matchId}/status`, { status }),
        setMockFotMobLiveMatchStatus: ({ matchId, status }) => postMockFotMobAdmin(`/__admin/matches/${matchId}/live-status`, { status }),
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

async function postMockFotMobAdmin(path, body = {}) {
  const response = await fetch(new URL(path, mockFotMobAdminUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Mock FotMob admin ${path} failed with ${response.status}: ${await response.text()}`);
  }

  return null;
}
