/**
 * As a logged-in FarmersLeague user, I want to open a match draft page, see the remaining draft turns as a horizontal queue,
 * and take turns drafting 3 starters per user, so that every league user can understand who picks now and next while building
 * a small squad from the match’s starting lineups without choosing already-drafted players.
 */
describe('Match draft page', () => {
  const alicePasskey = '11111111-1111-1111-1111-111111111111';
  const bobPasskey = '22222222-2222-2222-2222-222222222222';
  const matchId = 1001;

  const canadaStarters = [
    'Dayne St. Clair',
    'Alistair Johnston',
    'Kamal Miller',
    'Alphonso Davies',
    'Ismaël Koné',
    'Jonathan Osorio',
    'Nathan Saliba',
    'Tajon Buchanan',
    'Jonathan David',
    'Cyle Larin',
    'Stephen Eustáquio'
  ];

  const mexicoStarters = [
    'Raúl Rangel',
    'Israel Reyes',
    'César Montes',
    'Johan Vásquez',
    'Jesús Gallardo',
    'Érik Lira',
    'Orbelín Pineda',
    'Brian Gutiérrez',
    'Julián Quiñones',
    'Raúl Jiménez',
    'Roberto Alvarado'
  ];

  const setDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${matchId}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const setAliceBobDraft = (picks = []) => {
    setDraft({ draftOrder: ['Alice', 'Bob'], picks });
  };

  const draftPlayerRow = (player) => cy.contains('[data-test="draft-player"]', player);

  const clickDraft = (player) => {
    draftPlayerRow(player).within(() => cy.contains('button', 'Draft').click());
  };

  const draftAs = (passkey, playerName) => {
    cy.request('POST', `/api/drafts/${matchId}/picks`, { passkey, playerName })
      .its('status')
      .should('equal', 200);
  };

  const assertTurnQueue = (turns) => {
    cy.testGet('draft-turn-queue').find('[data-test="draft-turn-queue-item"]').should('have.length', turns.length);
    turns.forEach((turn, index) => {
      cy.testGet('draft-turn-queue').find('[data-test="draft-turn-queue-item"]').eq(index).should('contain.text', turn);
    });
  };

  beforeEach(() => {
    cy.request('DELETE', '/api/testing/drafts').its('status').should('equal', 204);
  });

  // GIVEN the test suite is preparing to verify draft behavior
  // WHEN each draft acceptance test starts
  // THEN the Redis draft cache is cleared so the test begins from a clean draft state
  it('starts each draft test with a cleared Redis draft cache', () => {
    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);

    cy.testGet('draft-summary').should('not.contain.text', 'Dayne St. Clair');
    cy.testGet('draft-status').should('not.contain.text', 'Draft complete');
  });

  // GIVEN Alice is logged in with a valid passkey and the matches list has loaded
  // WHEN she clicks the Canada vs Mexico match
  // THEN she is taken to a passkey-scoped draft page for that match showing both teams’ starting 11s as draftable players
  it('opens a passkey-scoped draft page with both teams starting 11s after clicking a match', () => {
    cy.visit(`/${alicePasskey}`);
    cy.testGet('match-card').contains('Canada vs Mexico').click();

    cy.location('pathname').should('equal', `/${alicePasskey}/matches/${matchId}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-title').should('contain.text', 'Canada vs Mexico Draft');
    cy.testGet('draft-lineup-Canada').within(() => {
      cy.contains('h2', 'Canada Starting 11').should('be.visible');
      canadaStarters.forEach((player) => {
        draftPlayerRow(player).should('be.visible');
      });
    });
    cy.testGet('draft-lineup-Mexico').within(() => {
      cy.contains('h2', 'Mexico Starting 11').should('be.visible');
      mexicoStarters.forEach((player) => {
        draftPlayerRow(player).should('be.visible');
      });
    });
  });

  // GIVEN Alice opens the Canada vs Mexico draft page for a fresh draft with Alice and Bob drafting 3 players each
  // WHEN the draft loads
  // THEN she sees a horizontal remaining-turn queue containing 6 turns in draft order: Alice, Bob, Alice, Bob, Alice, Bob
  it('shows a horizontal remaining-turn queue for every uncompleted pick', () => {
    setAliceBobDraft();

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);

    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 2);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob');
    assertTurnQueue(['Alice', 'Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
  });

  // GIVEN Alice opens the Canada vs Mexico draft page and Alice has already drafted once
  // WHEN the draft loads
  // THEN she sees a remaining-turn queue containing only the 5 remaining turns: Bob, Alice, Bob, Alice, Bob
  it('shows only remaining turns after completed picks are removed from the queue', () => {
    setAliceBobDraft([{ userName: 'Alice', playerName: 'Dayne St. Clair' }]);

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);

    assertTurnQueue(['Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('draft-picks-Alice').should('contain.text', 'Dayne St. Clair');
    cy.testGet('current-turn').should('not.exist');
  });

  // GIVEN it is Alice’s turn on the Canada vs Mexico draft page
  // WHEN Alice drafts an available player
  // THEN that player is assigned to Alice, becomes unavailable to other users, and the remaining-turn queue advances to Bob without separate current-turn text
  it('assigns Alice an available player, makes the player unavailable, and advances the turn queue', () => {
    setAliceBobDraft();

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);
    clickDraft('Dayne St. Clair');

    cy.testGet('draft-picks-Alice').should('contain.text', 'Dayne St. Clair');
    draftPlayerRow('Dayne St. Clair')
      .should('contain.text', 'Drafted by Alice')
      .find('button')
      .should('be.disabled');
    assertTurnQueue(['Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');

    cy.visit(`/${bobPasskey}/matches/${matchId}/draft`);
    draftPlayerRow('Dayne St. Clair')
      .should('contain.text', 'Drafted by Alice')
      .find('button')
      .should('be.disabled');
  });

  // GIVEN Alice and Bob both have the Canada vs Mexico draft page open for a fresh draft
  // WHEN Alice drafts an available player on her turn
  // THEN Bob’s already-open draft page updates without reload to show the player drafted by Alice, Bob as the first remaining turn, and the drafted player disabled
  it('live updates Bob’s open draft page after Alice drafts a player', () => {
    setAliceBobDraft();

    cy.visit(`/${bobPasskey}/matches/${matchId}/draft`);
    cy.testGet('draft-picks-Alice').should('not.contain.text', 'Dayne St. Clair');

    draftAs(alicePasskey, 'Dayne St. Clair');

    cy.testGet('draft-picks-Alice').should('contain.text', 'Dayne St. Clair');
    draftPlayerRow('Dayne St. Clair')
      .should('contain.text', 'Drafted by Alice')
      .find('button')
      .should('be.disabled');
    assertTurnQueue(['Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
  });

  // GIVEN Alice and Bob both have the Canada vs Mexico draft page open and it is Bob’s turn
  // WHEN Bob drafts an available player
  // THEN Alice’s already-open draft page updates without reload to show the player drafted by Bob, Alice as the first remaining turn, and the drafted player disabled
  it('live updates Alice’s open draft page after Bob drafts a player', () => {
    setAliceBobDraft([{ userName: 'Alice', playerName: 'Dayne St. Clair' }]);

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);
    assertTurnQueue(['Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('draft-picks-Bob').should('not.contain.text', 'Raúl Rangel');

    draftAs(bobPasskey, 'Raúl Rangel');

    cy.testGet('draft-picks-Bob').should('contain.text', 'Raúl Rangel');
    draftPlayerRow('Raúl Rangel')
      .should('contain.text', 'Drafted by Bob')
      .find('button')
      .should('be.disabled');
    assertTurnQueue(['Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
  });

  // GIVEN Alice and Bob are drafting the Canada vs Mexico starters
  // WHEN users continue drafting in turn order
  // THEN each user can draft up to exactly 3 players
  it('lets each user draft exactly 3 players in turn order', () => {
    setAliceBobDraft();

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);
    ['Dayne St. Clair', 'Alistair Johnston', 'Kamal Miller'].forEach((player) => {
      clickDraft(player);
      cy.visit(`/${bobPasskey}/matches/${matchId}/draft`);
      const bobPick = player === 'Dayne St. Clair' ? 'Raúl Rangel' : player === 'Alistair Johnston' ? 'Israel Reyes' : 'César Montes';
      clickDraft(bobPick);
      cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);
    });

    cy.testGet('draft-picks-Alice').find('[data-test="drafted-player"]').should('have.length', 3);
    cy.testGet('draft-picks-Bob').find('[data-test="drafted-player"]').should('have.length', 3);
    draftPlayerRow('Alphonso Davies').find('button').should('be.disabled');
  });

  // GIVEN every user has drafted 3 players
  // WHEN Alice views the draft page
  // THEN she sees a completed draft summary showing each user’s drafted players and no remaining-turn queue
  it('shows a completed draft summary after every user has drafted 3 players', () => {
    setAliceBobDraft([
      { userName: 'Alice', playerName: 'Dayne St. Clair' },
      { userName: 'Bob', playerName: 'Raúl Rangel' },
      { userName: 'Alice', playerName: 'Alistair Johnston' },
      { userName: 'Bob', playerName: 'Israel Reyes' },
      { userName: 'Alice', playerName: 'Kamal Miller' },
      { userName: 'Bob', playerName: 'César Montes' }
    ]);

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);

    cy.testGet('draft-status').should('contain.text', 'Draft complete');
    cy.testGet('draft-turn-queue').should('not.exist');
    cy.testGet('draft-summary').within(() => {
      cy.testGet('draft-picks-Alice').should('contain.text', 'Dayne St. Clair').and('contain.text', 'Alistair Johnston').and('contain.text', 'Kamal Miller');
      cy.testGet('draft-picks-Bob').should('contain.text', 'Raúl Rangel').and('contain.text', 'Israel Reyes').and('contain.text', 'César Montes');
    });
  });

  // GIVEN Alice and Bob both have the Canada vs Mexico draft page open with each user one pick away from completing the draft
  // WHEN the final player is drafted
  // THEN both already-open draft pages update without reload to show Draft complete, hide the remaining-turn queue, and show the completed draft summary for both users
  it('live updates an open draft page when the final pick completes the draft', () => {
    setAliceBobDraft([
      { userName: 'Alice', playerName: 'Dayne St. Clair' },
      { userName: 'Bob', playerName: 'Raúl Rangel' },
      { userName: 'Alice', playerName: 'Alistair Johnston' },
      { userName: 'Bob', playerName: 'Israel Reyes' },
      { userName: 'Alice', playerName: 'Kamal Miller' }
    ]);

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);
    cy.testGet('draft-status').should('not.contain.text', 'Draft complete');

    draftAs(bobPasskey, 'César Montes');

    cy.testGet('draft-status').should('contain.text', 'Draft complete');
    cy.testGet('current-turn').should('not.exist');
    cy.testGet('draft-turn-queue').should('not.exist');
    cy.testGet('draft-summary').within(() => {
      cy.testGet('draft-picks-Alice').should('contain.text', 'Dayne St. Clair').and('contain.text', 'Alistair Johnston').and('contain.text', 'Kamal Miller');
      cy.testGet('draft-picks-Bob').should('contain.text', 'Raúl Rangel').and('contain.text', 'Israel Reyes').and('contain.text', 'César Montes');
    });
    draftPlayerRow('César Montes')
      .should('contain.text', 'Drafted by Bob')
      .find('button')
      .should('be.disabled');
  });

  // GIVEN players have already been drafted for Canada vs Mexico
  // WHEN Alice refreshes or reopens the draft page using her passkey URL
  // THEN the draft order, drafted players, unavailable players, remaining-turn queue, and current/completed status are restored from Redis
  it('restores draft state from Redis after reopening the draft page', () => {
    setAliceBobDraft([
      { userName: 'Alice', playerName: 'Dayne St. Clair' },
      { userName: 'Bob', playerName: 'Raúl Rangel' }
    ]);

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);
    cy.reload();

    cy.testGet('draft-order').find('[data-test="draft-order-user"]').first().should('contain.text', 'Alice');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').last().should('contain.text', 'Bob');
    cy.testGet('draft-picks-Alice').should('contain.text', 'Dayne St. Clair');
    cy.testGet('draft-picks-Bob').should('contain.text', 'Raúl Rangel');
    draftPlayerRow('Dayne St. Clair').find('button').should('be.disabled');
    assertTurnQueue(['Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
    cy.testGet('draft-status').should('not.contain.text', 'Draft complete');
  });

  // GIVEN Bob opens the Canada vs Mexico draft page and the first remaining turn belongs to Alice
  // WHEN Bob views available players
  // THEN every available player’s Draft button is disabled so Bob cannot draft out of turn
  it('disables draft buttons when it is not the user’s turn', () => {
    setAliceBobDraft();

    cy.visit(`/${bobPasskey}/matches/${matchId}/draft`);

    assertTurnQueue(['Alice', 'Bob', 'Alice', 'Bob', 'Alice', 'Bob']);
    cy.testGet('current-turn').should('not.exist');
    cy.get('[data-test="draft-player"] button').should('have.length', 22).and('be.disabled');
    cy.testGet('draft-picks-Bob').should('not.contain.text', 'Dayne St. Clair');
    draftPlayerRow('Dayne St. Clair').should('not.contain.text', 'Drafted by Bob');
  });

  // GIVEN Alice opens the Canada vs Mexico draft page and a player has already been drafted
  // WHEN Alice attempts to draft that unavailable player
  // THEN the player is not drafted again and remains assigned to the original user
  it('prevents an unavailable player from being drafted again', () => {
    setAliceBobDraft([{ userName: 'Alice', playerName: 'Dayne St. Clair' }]);

    cy.visit(`/${bobPasskey}/matches/${matchId}/draft`);

    draftPlayerRow('Dayne St. Clair')
      .should('contain.text', 'Drafted by Alice')
      .find('button')
      .should('be.disabled');
    cy.testGet('draft-picks-Alice').find('[data-test="drafted-player"]').contains('Dayne St. Clair').should('have.length', 1);
    cy.testGet('draft-picks-Bob').should('not.contain.text', 'Dayne St. Clair');
  });

  // GIVEN Alice has opened the Canada vs Mexico draft page
  // WHEN the starting lineups are displayed as draftable players
  // THEN each lineup shows exactly 11 starters and no bench players
  it('shows exactly 11 draftable starters per team and no bench players', () => {
    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`);

    cy.testGet('draft-lineup-Canada').find('[data-test="draft-player"]').should('have.length', 11);
    cy.testGet('draft-lineup-Mexico').find('[data-test="draft-player"]').should('have.length', 11);
    cy.testGet('bench').should('not.exist');
    cy.contains('Bench').should('not.exist');
  });

  // GIVEN a visitor is not logged in with a valid passkey
  // WHEN they attempt to open the match draft page
  // THEN they see the no access page and cannot see draft content or the remaining-turn queue
  it('does not show draft content to visitors without a valid passkey', () => {
    cy.visit(`/99999999-9999-9999-9999-999999999999/matches/${matchId}/draft`);

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('draft-page').should('not.exist');
    cy.testGet('draft-turn-queue').should('not.exist');
    cy.testGet('draft-lineup-Canada').should('not.exist');
    cy.testGet('draft-lineup-Mexico').should('not.exist');
  });

  // GIVEN Alice opens the Canada vs Mexico draft page and the live draft connection fails
  // WHEN the failure is detected
  // THEN Alice sees an error explaining that live updates are unavailable
  it('shows an error when live draft updates are unavailable', () => {
    setAliceBobDraft();

    cy.visit(`/${alicePasskey}/matches/${matchId}/draft`, {
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
