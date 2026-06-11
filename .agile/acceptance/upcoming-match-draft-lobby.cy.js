/**
 * As a logged-in FarmersLeague user, I want to see upcoming matches on my user home page and manage each match’s draft
 * before kickoff, so that users can create and join a draft lobby before someone starts and closes it for drafting.
 */
describe('Upcoming match draft lobby', () => {
  const alicePasskey = '11111111-1111-1111-1111-111111111111';
  const bobPasskey = '22222222-2222-2222-2222-222222222222';
  const carolPasskey = '33333333-3333-3333-3333-333333333333';
  const matchId = 1001;

  const completedPicks = [
    { userName: 'Alice', playerName: 'Dayne St. Clair' },
    { userName: 'Bob', playerName: 'Raúl Rangel' },
    { userName: 'Alice', playerName: 'Alistair Johnston' },
    { userName: 'Bob', playerName: 'Israel Reyes' },
    { userName: 'Alice', playerName: 'Kamal Miller' },
    { userName: 'Bob', playerName: 'César Montes' }
  ];

  const setDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${matchId}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const matchCard = () => cy.contains('[data-test="match-card"]', 'Canada vs Mexico');

  const createDraftFromHome = () => {
    cy.visit(`/${alicePasskey}`);
    matchCard().within(() => cy.testGet('create-draft-button').click());
  };

  beforeEach(() => {
    cy.request('DELETE', '/api/testing/drafts').its('status').should('equal', 204);
  });

  // GIVEN Alice visits her passkey-scoped home page
  // WHEN the matches list loads
  // THEN she sees upcoming matches with each match’s teams and kickoff time
  it('shows upcoming matches with their teams and kickoff time on the user home page', () => {
    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-teams').should('contain.text', 'Canada vs Mexico');
      cy.testGet('match-kickoff').should('contain.text', 'Kickoff');
      cy.testGet('match-kickoff').should('contain.text', 'Jun');
    });
  });

  // GIVEN Alice sees an upcoming match with no draft created
  // WHEN she clicks Create draft
  // THEN a draft is created with Alice joined automatically and Alice is taken to that match’s draft page
  it('creates a draft with Alice joined and navigates her to the draft page', () => {
    createDraftFromHome();

    cy.location('pathname').should('equal', `/${alicePasskey}/matches/${matchId}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice');
  });

  // GIVEN an upcoming match has starting lineups but no full bench confirmed
  // WHEN Alice views the match on her passkey-scoped home page
  // THEN she cannot create or open a draft for that match yet
  it('hides draft creation until starting lineups and full benches are confirmed', () => {
    const starters = Array.from({ length: 11 }, (_, index) => ({
      name: `Starter ${index + 1}`,
      number: index + 1,
      position: null,
      grid: null,
      gridRow: null,
      gridColumn: null
    }));

    cy.intercept('GET', '/api/matches', [{
      id: matchId,
      homeTeam: 'Canada',
      awayTeam: 'Mexico',
      league: 'FIFA World Cup',
      date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      lineups: [
        { teamName: 'Canada', formation: '4-3-3', starters, bench: [] },
        { teamName: 'Mexico', formation: '4-3-3', starters, bench: [] }
      ],
      draft: null,
      hasStarted: false
    }]);

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('match-draft-status').should('contain.text', 'No draft yet');
    });
    matchCard().click();
    cy.location('pathname').should('equal', `/${alicePasskey}`);
  });

  // GIVEN Alice has created a draft for an upcoming match
  // WHEN Bob visits his passkey-scoped home page
  // THEN Bob sees that match marked Draft open with a Join draft button
  it('shows Bob an open draft with a join action after Alice creates it', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft open');
      cy.testGet('join-draft-button').should('be.visible').and('contain.text', 'Join draft');
      cy.testGet('create-draft-button').should('not.exist');
    });
  });

  // GIVEN Bob sees an upcoming match with Alice’s draft open
  // WHEN Bob clicks Join draft
  // THEN Bob is added to the draft and is taken to that match’s draft page
  it('lets Bob join an open draft and navigates him to the draft page', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${bobPasskey}`);
    matchCard().within(() => cy.testGet('join-draft-button').click());

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${matchId}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
  });

  // GIVEN Alice is the only user who has joined an upcoming match draft
  // WHEN she opens the draft page
  // THEN she sees a warning that starting a draft requires at least two joined users, the Start draft button is disabled, and Draft player buttons are disabled
  it('prevents starting or drafting when only one user has joined the draft', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);

    cy.testGet('draft-start-warning').should('be.visible').and('contain.text', 'at least two');
    cy.testGet('start-draft-button').should('be.disabled');
    cy.get('[data-test="draft-player"] button').should('have.length', 22).and('be.disabled');
  });

  // GIVEN at least two users have joined an upcoming match draft
  // WHEN a joined user opens the draft page
  // THEN they can see a Start draft button
  it('shows a start draft button to a joined user when at least two users have joined', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);

    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('start-draft-button').should('be.visible').and('not.be.disabled');
  });

  // GIVEN at least two users have joined an upcoming match draft
  // WHEN a joined user clicks Start draft
  // THEN the draft is closed to new joiners, the draft order is randomly decided from joined users, and drafting begins
  it('starts an open draft, closes joining, and creates a draft order from joined users', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);
    cy.testGet('start-draft-button').click();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 2);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('draft-turn-queue').find('[data-test="draft-turn-queue-item"]').should('have.length', 6);

    cy.visit(`/${carolPasskey}`);
    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft in progress');
      cy.testGet('join-draft-button').should('not.exist');
    });
  });

  // GIVEN an upcoming match has a started draft
  // WHEN Carol visits her passkey-scoped home page without having joined before it started
  // THEN Carol sees the match marked Draft in progress and cannot join it
  it('does not allow a user to join a draft after it has started', () => {
    setDraft({ status: 'started', joinedUsers: ['Alice', 'Bob'], draftOrder: ['Alice', 'Bob'], picks: [] });

    cy.visit(`/${carolPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft in progress');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('create-draft-button').should('not.exist');
    });
  });

  // GIVEN an upcoming match has an open or started draft
  // WHEN any logged-in user clicks Cancel draft from the home page
  // THEN the draft is removed, drafted decisions are cleared, and the match shows Create draft again
  it('allows any logged-in user to cancel a draft and clear drafted decisions', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: [{ userName: 'Alice', playerName: 'Dayne St. Clair' }]
    });

    cy.visit(`/${carolPasskey}`);
    matchCard().within(() => cy.testGet('cancel-draft-button').click());

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('be.visible').and('contain.text', 'Create draft');
      cy.testGet('match-draft-status').should('not.contain.text', 'Draft in progress');
    });

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);
    cy.testGet('draft-summary').should('not.contain.text', 'Dayne St. Clair');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice');
  });

  // GIVEN an upcoming match has a completed draft
  // WHEN Alice views her home page
  // THEN she sees the match marked Draft complete and does not see create, join, start, or cancel draft actions for that match
  it('shows completed drafts without draft management actions on the home page', () => {
    setDraft({ status: 'completed', joinedUsers: ['Alice', 'Bob'], draftOrder: ['Alice', 'Bob'], picks: completedPicks });

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft complete');
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('cancel-draft-button').should('not.exist');
      cy.testGet('start-draft-button').should('not.exist');
    });
  });

  // GIVEN a match kickoff time is in the past
  // WHEN Alice views her home page
  // THEN she sees the match marked Match started with no Create draft, Join draft, Start draft, or Cancel draft button
  it('does not allow draft actions after the match kickoff time has passed', () => {
    cy.clock(new Date('2026-06-12T00:00:00Z').getTime(), ['Date']);

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Match started');
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('cancel-draft-button').should('not.exist');
      cy.testGet('start-draft-button').should('not.exist');
    });
  });

  // GIVEN a visitor is not logged in with a valid passkey
  // WHEN they attempt to open the passkey-scoped home page
  // THEN they cannot see match draft controls
  it('does not show match draft controls to visitors without a valid passkey', () => {
    cy.visit('/99999999-9999-9999-9999-999999999999');

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('match-card').should('not.exist');
    cy.testGet('create-draft-button').should('not.exist');
    cy.testGet('join-draft-button').should('not.exist');
    cy.testGet('cancel-draft-button').should('not.exist');
  });
});
