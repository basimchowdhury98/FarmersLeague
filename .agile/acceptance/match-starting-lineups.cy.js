/**
 * As a logged-in FarmersLeague user, I want to open a match draft page, see the remaining draft turns as a horizontal queue,
 * and take turns drafting 3 starters per user, so that every league user can understand who picks now and next while building
 * a small squad from the match's starting lineups without choosing already-drafted players.
 */
describe('Match draft page', () => {
  const alicePasskey = '11111111-1111-1111-1111-111111111111';
  const bobPasskey = '22222222-2222-2222-2222-222222222222';
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

  const setAliceBobDraft = (picks = []) => {
    setDraft({ draftOrder: ['Alice', 'Bob'], picks });
  };

  const draftPath = (passkey) => `/${passkey}/matches/${match.id}/draft`;
  const draftPlayerRow = (player) => cy.contains('[data-test="draft-player"]', player);

  const clickDraft = (player) => {
    draftPlayerRow(player).within(() => cy.contains('button', 'Draft').click());
  };

  const draftAs = (passkey, playerName) => {
    cy.request('POST', `/api/drafts/${match.id}/picks`, { passkey, playerName })
      .its('status')
      .should('equal', 200);
  };

  const assertTurnQueue = (turns) => {
    cy.testGet('draft-turn-queue').find('[data-test="draft-turn-queue-item"]').should('have.length', turns.length);
    turns.forEach((turn, index) => {
      cy.testGet('draft-turn-queue').find('[data-test="draft-turn-queue-item"]').eq(index).should('contain.text', turn);
    });
  };

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

  it('starts each draft test with a cleared Redis draft cache', () => {
    cy.visit(draftPath(alicePasskey));

    cy.testGet('draft-summary').should('not.contain.text', homeStarters[0]);
    cy.testGet('draft-status').should('not.contain.text', 'Draft complete');
  });

  it('opens a passkey-scoped draft page with both teams starting 11s after clicking a match', () => {
    cy.visit(`/${alicePasskey}`);
    cy.testGet('match-card').contains(matchLabel).click();

    cy.location('pathname').should('equal', draftPath(alicePasskey));
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-title').should('contain.text', `${matchLabel} Draft`);
    cy.testGet(`draft-lineup-${match.homeTeam}`).within(() => {
      cy.contains('h2', `${match.homeTeam} Starting 11`).should('be.visible');
      homeStarters.forEach((player) => draftPlayerRow(player).should('be.visible'));
    });
    cy.testGet(`draft-lineup-${match.awayTeam}`).within(() => {
      cy.contains('h2', `${match.awayTeam} Starting 11`).should('be.visible');
      awayStarters.forEach((player) => draftPlayerRow(player).should('be.visible'));
    });
  });

  it('shows a horizontal remaining-turn queue for every uncompleted pick', () => {
    setAliceBobDraft();

    cy.visit(draftPath(alicePasskey));

    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 2);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob');
    assertTurnQueue(['Alice', 'Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
  });

  it('shows only remaining turns after completed picks are removed from the queue', () => {
    setAliceBobDraft([{ userName: 'Alice', playerName: homeStarters[0] }]);

    cy.visit(draftPath(alicePasskey));

    assertTurnQueue(['Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('draft-picks-Alice').should('contain.text', homeStarters[0]);
    cy.testGet('current-turn').should('not.exist');
  });

  it('assigns Alice an available player, makes the player unavailable, and advances the turn queue', () => {
    setAliceBobDraft();

    cy.visit(draftPath(alicePasskey));
    clickDraft(homeStarters[0]);

    cy.testGet('draft-picks-Alice').should('contain.text', homeStarters[0]);
    draftPlayerRow(homeStarters[0])
      .should('contain.text', 'Drafted by Alice')
      .find('button')
      .should('be.disabled');
    assertTurnQueue(['Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');

    cy.visit(draftPath(bobPasskey));
    draftPlayerRow(homeStarters[0])
      .should('contain.text', 'Drafted by Alice')
      .find('button')
      .should('be.disabled');
  });

  it('live updates Bob\'s open draft page after Alice drafts a player', () => {
    setAliceBobDraft();

    cy.visit(draftPath(bobPasskey));
    cy.testGet('draft-picks-Alice').should('not.contain.text', homeStarters[0]);

    draftAs(alicePasskey, homeStarters[0]);

    cy.testGet('draft-picks-Alice').should('contain.text', homeStarters[0]);
    draftPlayerRow(homeStarters[0])
      .should('contain.text', 'Drafted by Alice')
      .find('button')
      .should('be.disabled');
    assertTurnQueue(['Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
  });

  it('live updates Alice\'s open draft page after Bob drafts a player', () => {
    setAliceBobDraft([{ userName: 'Alice', playerName: homeStarters[0] }]);

    cy.visit(draftPath(alicePasskey));
    assertTurnQueue(['Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('draft-picks-Bob').should('not.contain.text', awayStarters[0]);

    draftAs(bobPasskey, awayStarters[0]);

    cy.testGet('draft-picks-Bob').should('contain.text', awayStarters[0]);
    draftPlayerRow(awayStarters[0])
      .should('contain.text', 'Drafted by Bob')
      .find('button')
      .should('be.disabled');
    assertTurnQueue(['Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
  });

  it('lets each user draft exactly 3 players in turn order', () => {
    setAliceBobDraft();

    cy.visit(draftPath(alicePasskey));
    homeStarters.slice(0, 3).forEach((player, index) => {
      clickDraft(player);
      cy.visit(draftPath(bobPasskey));
      clickDraft(awayStarters[index]);
      cy.visit(draftPath(alicePasskey));
    });

    cy.testGet('draft-picks-Alice').find('[data-test="drafted-player"]').should('have.length', 3);
    cy.testGet('draft-picks-Bob').find('[data-test="drafted-player"]').should('have.length', 3);
    draftPlayerRow(homeStarters[3]).find('button').should('be.disabled');
  });

  it('shows a completed draft summary after every user has drafted 3 players', () => {
    setAliceBobDraft(completedPicks());

    cy.visit(draftPath(alicePasskey));

    cy.testGet('draft-status').should('contain.text', 'Draft complete');
    cy.testGet('draft-turn-queue').should('not.exist');
    cy.testGet('draft-summary').within(() => {
      homeStarters.slice(0, 3).forEach((player) => cy.testGet('draft-picks-Alice').should('contain.text', player));
      awayStarters.slice(0, 3).forEach((player) => cy.testGet('draft-picks-Bob').should('contain.text', player));
    });
  });

  it('live updates an open draft page when the final pick completes the draft', () => {
    setAliceBobDraft(completedPicks().slice(0, 5));

    cy.visit(draftPath(alicePasskey));
    cy.testGet('draft-status').should('not.contain.text', 'Draft complete');

    draftAs(bobPasskey, awayStarters[2]);

    cy.testGet('draft-status').should('contain.text', 'Draft complete');
    cy.testGet('current-turn').should('not.exist');
    cy.testGet('draft-turn-queue').should('not.exist');
    cy.testGet('draft-summary').within(() => {
      homeStarters.slice(0, 3).forEach((player) => cy.testGet('draft-picks-Alice').should('contain.text', player));
      awayStarters.slice(0, 3).forEach((player) => cy.testGet('draft-picks-Bob').should('contain.text', player));
    });
    draftPlayerRow(awayStarters[2])
      .should('contain.text', 'Drafted by Bob')
      .find('button')
      .should('be.disabled');
  });

  it('restores draft state from Redis after reopening the draft page', () => {
    setAliceBobDraft(completedPicks().slice(0, 2));

    cy.visit(draftPath(alicePasskey));
    cy.reload();

    cy.testGet('draft-order').find('[data-test="draft-order-user"]').first().should('contain.text', 'Alice');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').last().should('contain.text', 'Bob');
    cy.testGet('draft-picks-Alice').should('contain.text', homeStarters[0]);
    cy.testGet('draft-picks-Bob').should('contain.text', awayStarters[0]);
    draftPlayerRow(homeStarters[0]).find('button').should('be.disabled');
    assertTurnQueue(['Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
    cy.testGet('draft-status').should('not.contain.text', 'Draft complete');
  });

  it('disables draft buttons when it is not the user\'s turn', () => {
    setAliceBobDraft();

    cy.visit(draftPath(bobPasskey));

    assertTurnQueue(['Alice', 'Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
    cy.get('[data-test="draft-player"] button').should('have.length', 22).and('be.disabled');
    cy.testGet('draft-picks-Bob').should('not.contain.text', homeStarters[0]);
    draftPlayerRow(homeStarters[0]).should('not.contain.text', 'Drafted by Bob');
  });

  it('prevents an unavailable player from being drafted again', () => {
    setAliceBobDraft([{ userName: 'Alice', playerName: homeStarters[0] }]);

    cy.visit(draftPath(bobPasskey));

    draftPlayerRow(homeStarters[0])
      .should('contain.text', 'Drafted by Alice')
      .find('button')
      .should('be.disabled');
    cy.testGet('draft-picks-Alice').find('[data-test="drafted-player"]').contains(homeStarters[0]).should('have.length', 1);
    cy.testGet('draft-picks-Bob').should('not.contain.text', homeStarters[0]);
  });

  it('shows exactly 11 draftable starters per team and no bench players', () => {
    cy.visit(draftPath(alicePasskey));

    cy.testGet(`draft-lineup-${match.homeTeam}`).find('[data-test="draft-player"]').should('have.length', 11);
    cy.testGet(`draft-lineup-${match.awayTeam}`).find('[data-test="draft-player"]').should('have.length', 11);
    cy.testGet('bench').should('not.exist');
    cy.contains('Bench').should('not.exist');
  });

  it('does not show draft content to visitors without a valid passkey', () => {
    cy.visit(`/99999999-9999-9999-9999-999999999999/matches/${match.id}/draft`);

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('draft-page').should('not.exist');
    cy.testGet('draft-turn-queue').should('not.exist');
    cy.testGet('draft-player').should('not.exist');
  });

  it('shows an error when live draft updates are unavailable', () => {
    setAliceBobDraft();

    cy.visit(draftPath(alicePasskey), {
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

    cy.testGet('draft-live-error').should('be.visible').and('contain.text', 'Live updates unavailable');
  });
});
