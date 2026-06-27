/**
 * As an admin league user, I want draft management actions restricted to admin passkeys while regular users can still join
 * and participate, so that only trusted admins control draft lifecycle changes.
 */
describe('Upcoming match draft lobby', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';
  const carolPasskey = 'carol-3333-3333-3333';
  const draftableMatchId = Cypress.env('mockMatches').confirmedLineups;
  const noLineupMatchId = Cypress.env('mockMatches').noLineups;
  const predictedLineupMatchId = Cypress.env('mockMatches').predictedLineups;
  const lineupUnavailableMessage = 'No lineup available yet. Draft can\'t start until the starting lineup is available.';

  let match;
  let noLineupMatch;
  let predictedLineupMatch;
  let matchLabel;
  let noLineupMatchLabel;
  let alicePlayers;
  let bobPlayers;
  let completedPicks;

  const loadDraftableMatch = () => {
    return cy.getMockMatch(draftableMatchId).then((mockMatch) => {
      match = mockMatch;
      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;

      return cy.getDraftLineups(draftableMatchId, alicePasskey).then((draft) => {
        expect(draft.lineups, 'draft page lineups').to.have.length(2);
        expect(draft.lineups.every((lineup) => lineup.starters.length === 11)).to.equal(true);

        alicePlayers = draft.homeStarters.slice(0, 3);
        bobPlayers = draft.awayStarters.slice(0, 3);
        completedPicks = [
          { userName: 'Alice', playerName: alicePlayers[0] },
          { userName: 'Bob', playerName: bobPlayers[0] },
          { userName: 'Alice', playerName: alicePlayers[1] },
          { userName: 'Bob', playerName: bobPlayers[1] },
          { userName: 'Alice', playerName: alicePlayers[2] },
          { userName: 'Bob', playerName: bobPlayers[2] }
        ];
      });
    });
  };

  const loadNoLineupMatch = () => {
    return cy.getMockMatch(noLineupMatchId).then((mockMatch) => {
      noLineupMatch = mockMatch;
      noLineupMatchLabel = `${noLineupMatch.homeTeam} vs ${noLineupMatch.awayTeam}`;
    });
  };

  const loadPredictedLineupMatch = () => {
    return cy.getMockMatch(predictedLineupMatchId).then((mockMatch) => {
      predictedLineupMatch = mockMatch;
    });
  };

  const arrangeOpenDraft = (joinedUsers = ['Alice']) => cy.arrangeOpenDraft(match.id, { joinedUsers });
  const arrangeStartedDraft = (picks = []) => cy.arrangeStartedDraft(match.id, { draftOrder: ['Alice', 'Bob'], picks });
  const arrangeCompletedDraft = () => cy.arrangeCompletedDraft(match.id, { draftOrder: ['Alice', 'Bob'], picks: completedPicks });
  const arrangeNoLineupOpenDraft = (joinedUsers = ['Alice']) => cy.arrangeOpenDraft(noLineupMatch.id, { joinedUsers });
  const arrangePredictedLineupOpenDraft = (joinedUsers = ['Alice', 'Bob']) => cy.arrangeOpenDraft(predictedLineupMatch.id, { joinedUsers });

  const matchCard = () => {
    return cy.findMatchCard(matchLabel);
  };
  const noLineupMatchCard = () => {
    return cy.findMatchCard(noLineupMatchLabel);
  };

  const assertTwoUserRoundRobinQueue = () => {
    cy.testGet('draft-turn-queue').find('[data-test="draft-turn-queue-item"]').then(($items) => {
      const turns = [...$items].map((item) => item.innerText.trim());
      expect(turns).to.have.length(6);
      expect(turns[0]).to.be.oneOf(['Alice', 'Bob']);
      expect(turns[1]).to.be.oneOf(['Alice', 'Bob']);
      expect(turns[0]).to.not.equal(turns[1]);
      expect(turns).to.deep.equal([turns[0], turns[1], turns[0], turns[1], turns[0], turns[1]]);
    });
  };

  const assertTwoUserAbbaQueue = () => {
    cy.testGet('draft-turn-queue').find('[data-test="draft-turn-queue-item"]').then(($items) => {
      const turns = [...$items].map((item) => item.innerText.trim());
      expect(turns).to.have.length(6);
      expect(turns[0]).to.be.oneOf(['Alice', 'Bob']);
      expect(turns[1]).to.be.oneOf(['Alice', 'Bob']);
      expect(turns[0]).to.not.equal(turns[1]);
      expect(turns).to.deep.equal([turns[0], turns[1], turns[1], turns[0], turns[0], turns[1]]);
    });
  };

  const assertThreeUserAbbaQueue = () => {
    cy.testGet('draft-turn-queue').find('[data-test="draft-turn-queue-item"]').then(($items) => {
      const turns = [...$items].map((item) => item.innerText.trim());
      const firstRound = turns.slice(0, 3);
      expect(turns).to.have.length(9);
      expect(firstRound).to.have.members(['Alice', 'Bob', 'Carol']);
      expect(turns).to.deep.equal([...firstRound, ...firstRound.slice().reverse(), ...firstRound]);
    });
  };

  const createDraftFromHome = () => {
    cy.visit(`/${alicePasskey}`);
    matchCard().within(() => cy.testGet('create-draft-button').click());
  };

  beforeEach(() => {
    cy.resetScraperMatches();
    loadDraftableMatch();
    cy.then(() => cy.arrangeNoDraft(match.id));
  });

  afterEach(() => {
    cy.resetScraperMatches();
  });

  it('shows upcoming matches with their teams and kickoff time on the user home page', () => {
    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-teams').should('contain.text', matchLabel);
      cy.testGet('match-kickoff').should('contain.text', 'Kickoff');
    });
  });

  it('allows an admin to create a draft from the match card with Alice joined and navigates her to the draft page', () => {
    cy.visit(`/${alicePasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice');
  });

  it('locks regular users out of match cards without drafts', () => {
    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'No draft yet');
      cy.testGet('create-draft-button').should('not.exist');
    });
    matchCard().should('have.class', 'match-locked').and('have.attr', 'aria-disabled', 'true').click();
    cy.location('pathname').should('equal', `/${bobPasskey}`);
  });

  it('shows draft creation without embedding lineups in the match list', () => {
    cy.intercept('GET', '/api/matches', [{
      ...match,
      lineups: [],
      draft: null,
      hasStarted: false
    }]);

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('be.visible');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('match-draft-status').should('contain.text', 'No draft yet');
    });
  });

  it('creates a draft for an upcoming match before lineups are available', () => {
    loadNoLineupMatch()
      .then(() => {
        cy.arrangeNoDraft(noLineupMatch.id);

        cy.visit(`/${alicePasskey}`);
        noLineupMatchCard().within(() => cy.testGet('create-draft-button').click());

        cy.location('pathname').should('equal', `/${alicePasskey}/matches/${noLineupMatch.id}/draft`);
        cy.testGet('draft-page').should('be.visible');
        cy.testGet('draft-status').should('contain.text', 'Draft open');
        cy.testGet('draft-joined-users').should('contain.text', 'Alice');
      });
  });

  it('shows Bob an open draft with a join action after Alice creates it', () => {
    arrangeOpenDraft(['Alice']);

    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft open');
      cy.testGet('join-draft-button').should('be.visible').and('contain.text', 'Join draft');
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('cancel-draft-button').should('not.exist');
    });
  });

  it('lets Bob join an open draft and navigates him to the draft page', () => {
    arrangeOpenDraft(['Alice']);

    cy.visit(`/${bobPasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
  });

  it('keeps the Join draft button available when a regular user can also join by clicking the card', () => {
    arrangeOpenDraft(['Alice']);

    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('join-draft-button').should('be.visible').and('contain.text', 'Join draft');
    });
  });

  it('reopens an open draft from the match card when the current user has already joined', () => {
    arrangeOpenDraft(['Alice', 'Bob']);

    cy.visit(`/${alicePasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
  });

  it('prevents starting or drafting when only one user has joined the draft', () => {
    arrangeOpenDraft(['Alice']);

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);

    cy.testGet('draft-start-warning').should('be.visible').and('contain.text', 'at least two');
    cy.testGet('start-draft-button').should('be.disabled');
    cy.get('[data-test="draft-player"] button').should('have.length', 22).and('be.disabled');
  });

  it('shows a start draft button to an admin when at least two users have joined', () => {
    arrangeOpenDraft(['Alice', 'Bob']);

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);

    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('start-draft-button').should('be.visible').and('not.be.disabled');
  });

  it('does not show regular users the start draft action', () => {
    arrangeOpenDraft(['Alice', 'Bob']);

    cy.visit(`/${bobPasskey}/matches/${match.id}/draft`);

    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('start-draft-button').should('not.exist');
  });

  it('enables starting a draft when enough users have joined and lineups are available', () => {
    arrangeOpenDraft(['Alice', 'Bob']);

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);

    cy.testGet('start-draft-button').should('be.visible').and('not.be.disabled');
    cy.get('[data-test="draft-player"]').should('have.length', 22);
  });

  it('blocks starting a draft when the lineup is unavailable', () => {
    loadNoLineupMatch()
      .then(() => {
        arrangeNoLineupOpenDraft(['Alice', 'Bob']);

        cy.visit(`/${alicePasskey}/matches/${noLineupMatch.id}/draft`);

        cy.testGet('lineup-unavailable-banner').should('be.visible').and('contain.text', lineupUnavailableMessage);
        cy.testGet('draft-start-warning').should('not.exist');
        cy.testGet('start-draft-button').should('be.disabled');
      });
  });

  it('treats a predicted Preview tab lineup as unavailable on the draft page', () => {
    loadPredictedLineupMatch()
      .then(() => {
        cy.arrangeNoDraft(predictedLineupMatch.id);
        arrangePredictedLineupOpenDraft(['Alice', 'Bob']);

        cy.visit(`/${alicePasskey}/matches/${predictedLineupMatch.id}/draft`);

        cy.testGet('lineup-unavailable-banner').should('be.visible').and('contain.text', lineupUnavailableMessage);
        cy.testGet('draft-start-warning').should('not.exist');
        cy.testGet('start-draft-button').should('be.disabled');
        cy.testGet('draft-player').should('not.exist');
        cy.testGet('bench').should('not.exist');
      });
  });

  it('shows both lineup and minimum-player warnings when both requirements are unmet', () => {
    loadNoLineupMatch()
      .then(() => {
        arrangeNoLineupOpenDraft(['Alice']);

        cy.visit(`/${alicePasskey}/matches/${noLineupMatch.id}/draft`);

        cy.testGet('lineup-unavailable-banner').should('be.visible').and('contain.text', lineupUnavailableMessage);
        cy.testGet('draft-start-warning').should('be.visible').and('contain.text', 'at least two');
        cy.testGet('start-draft-button').should('be.disabled');
      });
  });

  it('allows users to join a draft lobby before lineups are available', () => {
    loadNoLineupMatch()
      .then(() => {
        arrangeNoLineupOpenDraft(['Alice']);

        cy.visit(`/${bobPasskey}`);
        noLineupMatchCard().within(() => cy.testGet('join-draft-button').click());

        cy.location('pathname').should('equal', `/${bobPasskey}/matches/${noLineupMatch.id}/draft`);
        cy.testGet('draft-page').should('be.visible');
        cy.testGet('draft-status').should('contain.text', 'Draft open');
        cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
      });
  });

  it('hides the draftable player list when the lineup is unavailable', () => {
    loadNoLineupMatch()
      .then(() => {
        arrangeNoLineupOpenDraft(['Alice', 'Bob']);

        cy.visit(`/${alicePasskey}/matches/${noLineupMatch.id}/draft`);

        cy.testGet('lineup-unavailable-banner').should('be.visible');
        cy.testGet('draft-player').should('not.exist');
        cy.testGet('bench').should('not.exist');
      });
  });

  it('allows an admin to start a round robin draft with a repeated randomized joined-user order', () => {
    arrangeOpenDraft(['Alice', 'Bob']);

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('start-draft-button').click();
    cy.testGet('draft-order-mode-dialog').should('be.visible');
    cy.testGet('start-round-robin-draft-button').click();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 2);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob');
    assertTwoUserRoundRobinQueue();
  });

  it('allows an admin to start a two-user ABBA draft order', () => {
    arrangeOpenDraft(['Alice', 'Bob']);

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('start-draft-button').click();
    cy.testGet('draft-order-mode-dialog').should('be.visible');
    cy.testGet('start-abba-draft-button').click();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 2);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob');
    assertTwoUserAbbaQueue();
  });

  it('allows an admin to start a three-user ABBA draft order', () => {
    arrangeOpenDraft(['Alice', 'Bob', 'Carol']);

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('start-draft-button').click();
    cy.testGet('draft-order-mode-dialog').should('be.visible');
    cy.testGet('start-abba-draft-button').click();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 3);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob').and('contain.text', 'Carol');
    assertThreeUserAbbaQueue();
  });

  it('keeps the draft open when an admin cancels the draft order mode popup', () => {
    arrangeOpenDraft(['Alice', 'Bob']);

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('start-draft-button').click();
    cy.testGet('draft-order-mode-dialog').should('be.visible');
    cy.testGet('cancel-draft-order-mode-button').click();

    cy.testGet('draft-order-mode-dialog').should('not.exist');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-order').should('not.exist');
    cy.testGet('draft-turn-queue').should('not.exist');
  });

  it('does not allow a user to join a draft after it has started', () => {
    arrangeStartedDraft();

    cy.visit(`/${carolPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft in progress');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('create-draft-button').should('not.exist');
    });
  });

  const startedDraftWithPick = () => {
    arrangeStartedDraft([{ userName: 'Alice', playerName: alicePlayers[0] }]);
  };

  const cancelDraftFromHome = () => {
    cy.visit(`/${alicePasskey}`);
    matchCard().within(() => cy.testGet('cancel-draft-button').click());
  };

  it('allows an admin to cancel a draft from the home page', () => {
    startedDraftWithPick();

    cancelDraftFromHome();

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('be.visible').and('contain.text', 'Create draft');
      cy.testGet('match-draft-status').should('not.contain.text', 'Draft in progress');
    });
  });

  it('clears drafted decisions when an admin cancels a draft', () => {
    startedDraftWithPick();

    cancelDraftFromHome();

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-summary').should('not.contain.text', alicePlayers[0]);
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice');
  });

  it('does not show regular users the cancel draft action', () => {
    arrangeStartedDraft();

    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft in progress');
      cy.testGet('cancel-draft-button').should('not.exist');
    });
  });

  it('rejects regular user draft creation through the API', () => {
    cy.request({
      method: 'POST',
      url: `/api/drafts/${match.id}`,
      body: { passkey: bobPasskey },
      failOnStatusCode: false
    }).its('status').should('equal', 403);
  });

  it('rejects regular user draft start through the API', () => {
    arrangeOpenDraft(['Alice', 'Bob']);

    cy.request({
      method: 'POST',
      url: `/api/drafts/${match.id}/start`,
      body: { passkey: bobPasskey },
      failOnStatusCode: false
    }).its('status').should('equal', 403);
  });

  it('rejects regular user draft cancellation through the API', () => {
    arrangeStartedDraft();

    cy.request({
      method: 'DELETE',
      url: `/api/drafts/${match.id}?passkey=${encodeURIComponent(bobPasskey)}`,
      failOnStatusCode: false
    }).its('status').should('equal', 403);
  });

  it('shows completed drafts without draft management actions on the home page', () => {
    arrangeCompletedDraft();

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft complete');
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('cancel-draft-button').should('not.exist');
      cy.testGet('start-draft-button').should('not.exist');
    });
  });

  it('opens the live match page from a completed draft card', () => {
    arrangeCompletedDraft();

    cy.visit(`/${bobPasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${match.id}/live`);
    cy.testGet('live-match-page').should('be.visible');
  });

  it('opens the live match results page from a completed draft card after the match ends', () => {
    cy.arrangeFinishedMatch(match.id);
    arrangeCompletedDraft();

    cy.visit(`/${bobPasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${match.id}/live`);
    cy.testGet('live-match-result').should('be.visible').and('contain.text', 'Final result');
  });

  it('keeps draft actions available after kickoff time until the scraper says the match has started', () => {
    cy.clock(new Date(match.date).getTime() + 60 * 1000, ['Date']);

    cy.visit(`/${alicePasskey}`);

    cy.findMatchCard(matchLabel).within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'No draft yet');
      cy.testGet('create-draft-button').should('be.visible');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('cancel-draft-button').should('not.exist');
      cy.testGet('start-draft-button').should('not.exist');
    });
  });

  it('does not show match draft controls to visitors without a valid passkey', () => {
    cy.visit('/mallory-9999-9999-9999');

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('match-card').should('not.exist');
    cy.testGet('create-draft-button').should('not.exist');
    cy.testGet('join-draft-button').should('not.exist');
    cy.testGet('cancel-draft-button').should('not.exist');
  });
});
