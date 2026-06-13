/**
 * As a logged-in FarmersLeague user, I want to see upcoming matches on my user home page and manage each match's draft
 * before kickoff, so that users can create and join a draft lobby before someone starts and closes it for drafting.
 */
describe('Upcoming match draft lobby', () => {
  const alicePasskey = '11111111-1111-1111-1111-111111111111';
  const bobPasskey = '22222222-2222-2222-2222-222222222222';
  const carolPasskey = '33333333-3333-3333-3333-333333333333';
  const fullBenchPlayerCount = 15;

  let match;
  let matchLabel;
  let alicePlayers;
  let bobPlayers;
  let completedPicks;

  const loadDraftableMatch = () => {
    cy.request('/api/matches').then(({ body }) => {
      match = body.find((candidate) => (
        candidate.lineups.length >= 2
        && candidate.lineups.every((lineup) => lineup.starters.length === 11 && lineup.bench.length === fullBenchPlayerCount)
        && new Date(candidate.date).getTime() > Date.now()
      ));

      expect(match, 'draftable scraper match').to.exist;
      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;
      alicePlayers = match.lineups[0].starters.slice(0, 3).map((player) => player.name);
      bobPlayers = match.lineups[1].starters.slice(0, 3).map((player) => player.name);
      completedPicks = [
        { userName: 'Alice', playerName: alicePlayers[0] },
        { userName: 'Bob', playerName: bobPlayers[0] },
        { userName: 'Alice', playerName: alicePlayers[1] },
        { userName: 'Bob', playerName: bobPlayers[1] },
        { userName: 'Alice', playerName: alicePlayers[2] },
        { userName: 'Bob', playerName: bobPlayers[2] }
      ];
    });
  };

  const setDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${match.id}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const matchCard = () => cy.contains('[data-test="match-card"]', matchLabel);

  const createDraftFromHome = () => {
    cy.visit(`/${alicePasskey}`);
    matchCard().within(() => cy.testGet('create-draft-button').click());
  };

  beforeEach(() => {
    loadDraftableMatch();
    cy.then(() => cy.request('DELETE', `/api/testing/drafts/${match.id}`).its('status').should('equal', 204));
  });

  it('shows upcoming matches with their teams and kickoff time on the user home page', () => {
    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-teams').should('contain.text', matchLabel);
      cy.testGet('match-kickoff').should('contain.text', 'Kickoff');
    });
  });

  it('creates a draft with Alice joined and navigates her to the draft page', () => {
    createDraftFromHome();

    cy.location('pathname').should('equal', `/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice');
  });

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
      ...match,
      lineups: [
        { teamName: match.homeTeam, formation: '4-3-3', starters, bench: [] },
        { teamName: match.awayTeam, formation: '4-3-3', starters, bench: [] }
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

  it('shows Bob an open draft with a join action after Alice creates it', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft open');
      cy.testGet('join-draft-button').should('be.visible').and('contain.text', 'Join draft');
      cy.testGet('create-draft-button').should('not.exist');
    });
  });

  it('lets Bob join an open draft and navigates him to the draft page', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${bobPasskey}`);
    matchCard().within(() => cy.testGet('join-draft-button').click());

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
  });

  it('prevents starting or drafting when only one user has joined the draft', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);

    cy.testGet('draft-start-warning').should('be.visible').and('contain.text', 'at least two');
    cy.testGet('start-draft-button').should('be.disabled');
    cy.get('[data-test="draft-player"] button').should('have.length', 22).and('be.disabled');
  });

  it('shows a start draft button to a joined user when at least two users have joined', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);

    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('start-draft-button').should('be.visible').and('not.be.disabled');
  });

  it('starts an open draft, closes joining, and creates a draft order from joined users', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
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

  it('does not allow a user to join a draft after it has started', () => {
    setDraft({ status: 'started', joinedUsers: ['Alice', 'Bob'], draftOrder: ['Alice', 'Bob'], picks: [] });

    cy.visit(`/${carolPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft in progress');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('create-draft-button').should('not.exist');
    });
  });

  it('allows any logged-in user to cancel a draft and clear drafted decisions', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: [{ userName: 'Alice', playerName: alicePlayers[0] }]
    });

    cy.visit(`/${carolPasskey}`);
    matchCard().within(() => cy.testGet('cancel-draft-button').click());

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('be.visible').and('contain.text', 'Create draft');
      cy.testGet('match-draft-status').should('not.contain.text', 'Draft in progress');
    });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-summary').should('not.contain.text', alicePlayers[0]);
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice');
  });

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

  it('does not allow draft actions after the match kickoff time has passed', () => {
    cy.clock(new Date(match.date).getTime() + 60 * 1000, ['Date']);

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Match started');
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('cancel-draft-button').should('not.exist');
      cy.testGet('start-draft-button').should('not.exist');
    });
  });

  it('does not show match draft controls to visitors without a valid passkey', () => {
    cy.visit('/99999999-9999-9999-9999-999999999999');

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('match-card').should('not.exist');
    cy.testGet('create-draft-button').should('not.exist');
    cy.testGet('join-draft-button').should('not.exist');
    cy.testGet('cancel-draft-button').should('not.exist');
  });
});
