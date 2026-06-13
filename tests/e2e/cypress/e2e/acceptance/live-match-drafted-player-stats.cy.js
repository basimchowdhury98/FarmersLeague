/**
 * As a drafted league user, I want a completed draft to automatically open a live match page showing every user's drafted
 * players and all available scraper stats, so that I can follow each squad's performance with my own squad emphasized.
 */
describe('Live match drafted player stats', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';
  const fullBenchPlayerCount = 15;

  let match;
  let matchLabel;
  let homeStarters;
  let awayStarters;

  const loadDraftableMatch = () => {
    cy.request('/api/matches').then(({ body }) => {
      match = body.find((candidate) => (
        new Date(candidate.date).getTime() > Date.now()
      ));

      expect(match, 'upcoming scraper match').to.exist;
      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;

      cy.request(`/api/drafts/${match.id}?passkey=${alicePasskey}`).then(({ body: draft }) => {
        expect(draft.match.lineups, 'draft page lineups').to.have.length(2);
        expect(draft.match.lineups.every((lineup) => lineup.starters.length === 11 && lineup.bench.length === fullBenchPlayerCount)).to.equal(true);

        homeStarters = draft.match.lineups[0].starters.map((player) => player.name);
        awayStarters = draft.match.lineups[1].starters.map((player) => player.name);
      });
    });
  };

  const setDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${match.id}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const draftAs = (passkey, playerName) => {
    cy.request('POST', `/api/drafts/${match.id}/picks`, { passkey, playerName })
      .its('status')
      .should('equal', 200);
  };

  const clickDraft = (playerName) => {
    cy.contains('[data-test="draft-player"]', playerName).within(() => cy.contains('button', 'Draft').click());
  };

  const livePath = (passkey) => `/${passkey}/matches/${match.id}/live`;
  const draftPath = (passkey) => `/${passkey}/matches/${match.id}/draft`;

  const completedPicks = () => [
    { userName: 'Alice', playerName: homeStarters[0] },
    { userName: 'Bob', playerName: awayStarters[0] },
    { userName: 'Alice', playerName: homeStarters[1] },
    { userName: 'Bob', playerName: awayStarters[1] },
    { userName: 'Alice', playerName: homeStarters[2] },
    { userName: 'Bob', playerName: awayStarters[2] }
  ];

  beforeEach(() => {
    loadDraftableMatch();
    cy.then(() => cy.request('DELETE', `/api/testing/drafts/${match.id}`).its('status').should('equal', 204));
  });

  // GIVEN Alice and Bob have an in-progress draft with one pick remaining and Bob has the draft page open
  // WHEN Bob makes the final pick
  // THEN Bob is automatically navigated to that match's live page
  it('automatically navigates the user who makes the final pick to the live page', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 5)
    });

    cy.visit(draftPath(bobPasskey));
    clickDraft(awayStarters[2]);

    cy.location('pathname').should('equal', livePath(bobPasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
  });

  // GIVEN Alice has an in-progress draft page open and Bob has one pick remaining
  // WHEN Bob's final pick completes the draft from another session
  // THEN Alice is also automatically navigated to that match's live page
  it('automatically navigates other users watching the draft when the final pick completes it', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 5)
    });

    cy.visit(draftPath(alicePasskey));
    cy.testGet('draft-page').should('be.visible');

    draftAs(bobPasskey, awayStarters[2]);

    cy.location('pathname').should('equal', livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
  });

  // GIVEN a draft is complete and Alice opens the live match page
  // WHEN the page loads
  // THEN all drafted squads are grouped by user, with Alice's squad first and visually highlighted as the current user's squad
  it('shows every drafted squad with the current user first and highlighted', () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Bob', 'Alice'],
      picks: completedPicks()
    });

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-squad').should('have.length', 2);
    cy.testGet('live-squad').first().should('contain.text', 'Alice').and('have.attr', 'data-current-user', 'true');
    cy.testGet('current-user-live-squad').should('contain.text', 'Alice').and('contain.text', homeStarters[0]);
    cy.testGet('live-squad').last().should('contain.text', 'Bob').and('contain.text', awayStarters[0]);
  });

  // GIVEN a draft is complete and scraper stats are available for drafted players
  // WHEN Alice opens the live match page
  // THEN each drafted player shows every stat category and stat field returned by the scraper for that player
  it('loads the first scraper stats state and shows all available stat fields for drafted players', () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks()
    });

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-player-card').should('have.length', 6);
    cy.contains('[data-test="live-player-card"]', homeStarters[0]).within(() => {
      cy.testGet('live-player-team').should('contain.text', match.homeTeam);
      cy.testGet('live-player-stats').should('contain.text', 'Attack');
      cy.testGet('live-player-stats').should('contain.text', 'Goals');
      cy.testGet('live-player-stats').should('contain.text', 'Expected goals');
      cy.testGet('live-player-stats').should('contain.text', 'Total shots');
      cy.testGet('live-player-stats').should('contain.text', 'Shots on target');
      cy.testGet('live-player-stats').should('contain.text', 'Touches in opposition box');
      cy.testGet('live-player-stats').should('contain.text', 'Passes');
      cy.testGet('live-player-stats').should('contain.text', 'Touches');
      cy.testGet('live-player-stats').should('contain.text', 'Accurate passes');
      cy.testGet('live-player-stats').should('contain.text', 'Assists');
      cy.testGet('live-player-stats').should('contain.text', 'Expected assists');
      cy.testGet('live-player-stats').should('contain.text', 'Chances created');
      cy.testGet('live-player-stats').should('contain.text', 'Defense');
      cy.testGet('live-player-stats').should('contain.text', 'Defensive actions');
      cy.testGet('live-player-stats').should('contain.text', 'Tackles');
      cy.testGet('live-player-stats').should('contain.text', 'Interceptions');
      cy.testGet('live-player-stats').should('contain.text', 'Recoveries');
      cy.testGet('live-player-stats').should('contain.text', 'Duels');
      cy.testGet('live-player-stats').should('contain.text', 'Duels won');
      cy.testGet('live-player-stats').should('contain.text', 'Duels lost');
      cy.testGet('live-player-stats').should('contain.text', 'Ground duels won');
      cy.testGet('live-player-stats').should('contain.text', 'Fouls');
      cy.testGet('live-player-stats').should('contain.text', 'Was fouled');
    });
  });

  // GIVEN a draft is not complete
  // WHEN Alice opens that match's live page directly
  // THEN she is not shown the live match stats page and sees a message that the match has not started yet
  it('does not show live match stats before the draft is complete', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 2)
    });

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-match-unavailable').should('be.visible').and('contain.text', 'Match has not started yet');
    cy.testGet('live-match-page').should('not.exist');
    cy.testGet('live-player-card').should('not.exist');
  });

  // GIVEN a draft is complete but a drafted player has no returned scraper stats yet
  // WHEN Alice opens the live match page
  // THEN that drafted player is still shown with a no-stats state instead of breaking the page
  it('shows drafted players without scraper stats using a no-stats state', () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: [
        { userName: 'Alice', playerName: 'Unknown Academy Player' },
        { userName: 'Bob', playerName: awayStarters[0] },
        { userName: 'Alice', playerName: homeStarters[1] },
        { userName: 'Bob', playerName: awayStarters[1] },
        { userName: 'Alice', playerName: homeStarters[2] },
        { userName: 'Bob', playerName: awayStarters[2] }
      ]
    });

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-player-card"]', 'Unknown Academy Player').within(() => {
      cy.testGet('live-player-no-stats').should('be.visible').and('contain.text', 'No stats available yet');
      cy.testGet('live-player-stats').should('not.exist');
    });
    cy.contains('[data-test="live-player-card"]', awayStarters[0]).within(() => {
      cy.testGet('live-player-stats').should('be.visible');
    });
  });

  // GIVEN a visitor does not have a valid passkey
  // WHEN they open a match live page directly
  // THEN they see the existing no-access page instead of live match content
  it('does not show live match content to visitors without a valid passkey', () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks()
    });

    cy.visit(`/mallory-9999-9999-9999/matches/${match.id}/live`);

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('live-match-page').should('not.exist');
    cy.testGet('live-player-card').should('not.exist');
  });
});
