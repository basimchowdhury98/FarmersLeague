/**
 * As an admin league user, I want draft management actions restricted to admin passkeys while regular users can still join
 * and participate, so that only trusted admins control draft lifecycle changes.
 */
describe('Upcoming match draft lobby', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';
  const carolPasskey = 'carol-3333-3333-3333';
  const predictedLineupMatchId = 1003;
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
    return cy.request('/api/matches').then(({ body }) => {
      const upcomingMatches = body.filter((candidate) => (
        new Date(candidate.date).getTime() > Date.now()
      ));

      const findDraftableMatch = (remainingMatches) => {
        expect(remainingMatches, 'upcoming scraper matches').to.have.length.greaterThan(0);
        const [candidate, ...rest] = remainingMatches;

        return cy.request({
          url: `/api/drafts/${candidate.id}?passkey=${alicePasskey}`,
          failOnStatusCode: false
        }).then((response) => {
          const lineups = response.body?.match?.lineups ?? [];
          const hasFullLineups = response.status === 200
            && lineups.length === 2
            && lineups.every((lineup) => lineup.starters.length === 11);

          if (!hasFullLineups) {
            return findDraftableMatch(rest);
          }

          match = candidate;
          matchLabel = `${candidate.homeTeam} vs ${candidate.awayTeam}`;
          alicePlayers = lineups[0].starters.slice(0, 3).map((player) => player.name);
          bobPlayers = lineups[1].starters.slice(0, 3).map((player) => player.name);
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

      return findDraftableMatch(upcomingMatches);
    });
  };

  const loadNoLineupMatch = () => {
    return cy.request('/api/matches').then(({ body }) => {
      const upcomingMatches = body.filter((candidate) => (
        new Date(candidate.date).getTime() > Date.now()
      ));

      const findNoLineupMatch = (remainingMatches) => {
        expect(remainingMatches, 'upcoming scraper matches').to.have.length.greaterThan(0);
        const [candidate, ...rest] = remainingMatches;

        return cy.request({
          url: `/api/drafts/${candidate.id}?passkey=${alicePasskey}`,
          failOnStatusCode: false
        }).then((response) => {
          if (response.status === 200 && response.body.match?.lineups?.length === 0) {
            noLineupMatch = candidate;
            noLineupMatchLabel = `${candidate.homeTeam} vs ${candidate.awayTeam}`;
            return;
          }

          if (response.status === 404) {
            noLineupMatch = candidate;
            noLineupMatchLabel = `${candidate.homeTeam} vs ${candidate.awayTeam}`;
            return;
          }

          return findNoLineupMatch(rest);
        });
      };

      return findNoLineupMatch(upcomingMatches);
    });
  };

  const loadPredictedLineupMatch = () => {
    return cy.request('/api/matches').then(({ body }) => {
      predictedLineupMatch = body.find((candidate) => candidate.id === predictedLineupMatchId);

      expect(predictedLineupMatch, 'predicted-lineup scraper match').to.exist;
    });
  };

  const setDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${match.id}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const setNoLineupDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${noLineupMatch.id}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const setPredictedLineupDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${predictedLineupMatch.id}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const matchCard = () => cy.contains('[data-test="match-card"]', matchLabel);
  const noLineupMatchCard = () => cy.contains('[data-test="match-card"]', noLineupMatchLabel);

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

  const showMatchDateTab = () => {
    const matchDate = new Date(match.date);
    const today = new Date();
    const matchDay = new Date(matchDate.getFullYear(), matchDate.getMonth(), matchDate.getDate()).getTime();
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    if (matchDay > todayDay) {
      cy.testGet('upcoming-matches-tab').click();
    } else if (matchDay < todayDay) {
      cy.testGet('past-matches-tab').click();
    }
  };

  beforeEach(() => {
    cy.resetScraperMatches();
    loadDraftableMatch();
    cy.then(() => cy.request('DELETE', `/api/testing/drafts/${match.id}`).its('status').should('equal', 204));
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

  // GIVEN Alice is an admin and an upcoming match has no draft yet
  // WHEN Alice clicks that match card
  // THEN a draft is created, Alice is joined, and she is navigated to the draft page
  it('allows an admin to create a draft from the match card with Alice joined and navigates her to the draft page', () => {
    cy.visit(`/${alicePasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice');
  });

  // GIVEN Bob is a regular user and an upcoming match has no draft yet
  // WHEN Bob opens the home page and clicks the match card
  // THEN he does not see draft creation controls and remains on the home page
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

  // GIVEN Alice is an admin and an upcoming match has no draft yet, even though its lineup is unavailable
  // WHEN Alice clicks that match's Create draft button
  // THEN she is taken to that match's draft page with the draft open and herself joined
  it('creates a draft for an upcoming match before lineups are available', () => {
    loadNoLineupMatch()
      .then(() => {
        cy.request('DELETE', `/api/testing/drafts/${noLineupMatch.id}`).its('status').should('equal', 204);

        cy.visit(`/${alicePasskey}`);
        noLineupMatchCard().within(() => cy.testGet('create-draft-button').click());

        cy.location('pathname').should('equal', `/${alicePasskey}/matches/${noLineupMatch.id}/draft`);
        cy.testGet('draft-page').should('be.visible');
        cy.testGet('draft-status').should('contain.text', 'Draft open');
        cy.testGet('draft-joined-users').should('contain.text', 'Alice');
      });
  });

  // GIVEN Bob is a regular user and Alice has created an open draft
  // WHEN Bob opens the home page
  // THEN Bob can join the draft but does not receive draft lifecycle controls
  it('shows Bob an open draft with a join action after Alice creates it', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft open');
      cy.testGet('join-draft-button').should('be.visible').and('contain.text', 'Join draft');
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('cancel-draft-button').should('not.exist');
    });
  });

  it('lets Bob join an open draft and navigates him to the draft page', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${bobPasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
  });

  it('keeps the Join draft button available when a regular user can also join by clicking the card', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('join-draft-button').should('be.visible').and('contain.text', 'Join draft');
    });
  });

  it('reopens an open draft from the match card when the current user has already joined', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
  });

  it('prevents starting or drafting when only one user has joined the draft', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);

    cy.testGet('draft-start-warning').should('be.visible').and('contain.text', 'at least two');
    cy.testGet('start-draft-button').should('be.disabled');
    cy.get('[data-test="draft-player"] button').should('have.length', 22).and('be.disabled');
  });

  it('shows a start draft button to an admin when at least two users have joined', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);

    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('start-draft-button').should('be.visible').and('not.be.disabled');
  });

  // GIVEN Bob is a regular user and an open draft has at least two joined users with lineups available
  // WHEN Bob opens the draft page
  // THEN he does not see the Start draft button
  it('does not show regular users the start draft action', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${bobPasskey}/matches/${match.id}/draft`);

    cy.testGet('draft-status').should('contain.text', 'Draft open');
    cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('start-draft-button').should('not.exist');
  });

  // GIVEN Alice is an admin, an open draft has at least two joined users, and the scraper returns starting 11 plus bench for both teams
  // WHEN Alice opens the draft page
  // THEN the Start draft button is enabled and the starting 11 players are shown as draftable
  it('enables starting a draft when enough users have joined and lineups are available', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);

    cy.testGet('start-draft-button').should('be.visible').and('not.be.disabled');
    cy.get('[data-test="draft-player"]').should('have.length', 22);
  });

  // GIVEN an open draft has at least two joined users but the scraper returns 404 for that match's lineup
  // WHEN a joined user opens the draft page
  // THEN a lineup-unavailable banner explains that the draft cannot start until the starting lineup is available and Start draft is disabled
  it('blocks starting a draft when the lineup is unavailable', () => {
    loadNoLineupMatch()
      .then(() => {
        setNoLineupDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

        cy.visit(`/${alicePasskey}/matches/${noLineupMatch.id}/draft`);

        cy.testGet('lineup-unavailable-banner').should('be.visible').and('contain.text', lineupUnavailableMessage);
        cy.testGet('draft-start-warning').should('not.exist');
        cy.testGet('start-draft-button').should('be.disabled');
      });
  });

  // GIVEN an open draft has at least two joined users but the Preview tab lineup is marked as predicted
  // WHEN a joined user opens the draft page
  // THEN the lineup-unavailable banner uses the current unavailable-lineup message, Start draft is disabled, and no draftable players are shown
  it('treats a predicted Preview tab lineup as unavailable on the draft page', () => {
    loadPredictedLineupMatch()
      .then(() => {
        cy.request('DELETE', `/api/testing/drafts/${predictedLineupMatch.id}`).its('status').should('equal', 204);
        setPredictedLineupDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

        cy.visit(`/${alicePasskey}/matches/${predictedLineupMatch.id}/draft`);

        cy.testGet('lineup-unavailable-banner').should('be.visible').and('contain.text', lineupUnavailableMessage);
        cy.testGet('draft-start-warning').should('not.exist');
        cy.testGet('start-draft-button').should('be.disabled');
        cy.testGet('draft-player').should('not.exist');
        cy.testGet('bench').should('not.exist');
      });
  });

  // GIVEN an open draft has only one joined user and the scraper returns 404 for that match's lineup
  // WHEN that joined user opens the draft page
  // THEN both the lineup-unavailable banner and the existing at-least-two-users warning are visible, and Start draft is disabled
  it('shows both lineup and minimum-player warnings when both requirements are unmet', () => {
    loadNoLineupMatch()
      .then(() => {
        setNoLineupDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

        cy.visit(`/${alicePasskey}/matches/${noLineupMatch.id}/draft`);

        cy.testGet('lineup-unavailable-banner').should('be.visible').and('contain.text', lineupUnavailableMessage);
        cy.testGet('draft-start-warning').should('be.visible').and('contain.text', 'at least two');
        cy.testGet('start-draft-button').should('be.disabled');
      });
  });

  // GIVEN an open draft exists for a match whose lineup is unavailable
  // WHEN another logged-in user opens the home page
  // THEN they can still join the draft lobby
  it('allows users to join a draft lobby before lineups are available', () => {
    loadNoLineupMatch()
      .then(() => {
        setNoLineupDraft({ status: 'open', joinedUsers: ['Alice'], draftOrder: [], picks: [] });

        cy.visit(`/${bobPasskey}`);
        noLineupMatchCard().within(() => cy.testGet('join-draft-button').click());

        cy.location('pathname').should('equal', `/${bobPasskey}/matches/${noLineupMatch.id}/draft`);
        cy.testGet('draft-page').should('be.visible');
        cy.testGet('draft-status').should('contain.text', 'Draft open');
        cy.testGet('draft-joined-users').should('contain.text', 'Alice').and('contain.text', 'Bob');
      });
  });

  // GIVEN the scraper mock match has no lineup available
  // WHEN a logged-in user opens that match's draft page
  // THEN no draftable player list is shown
  it('hides the draftable player list when the lineup is unavailable', () => {
    loadNoLineupMatch()
      .then(() => {
        setNoLineupDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

        cy.visit(`/${alicePasskey}/matches/${noLineupMatch.id}/draft`);

        cy.testGet('lineup-unavailable-banner').should('be.visible');
        cy.testGet('draft-player').should('not.exist');
        cy.testGet('bench').should('not.exist');
      });
  });

  // GIVEN Alice is an admin and an open draft has at least two joined users with lineups available
  // WHEN Alice clicks Start draft and chooses Round robin
  // THEN the draft starts with a randomized joined-user order repeated for 3 picks per user
  it('allows an admin to start a round robin draft with a repeated randomized joined-user order', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('start-draft-button').click();
    cy.testGet('draft-order-mode-dialog').should('be.visible');
    cy.testGet('start-round-robin-draft-button').click();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 2);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob');
    assertTwoUserRoundRobinQueue();

    cy.visit(`/${carolPasskey}`);
    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft in progress');
      cy.testGet('join-draft-button').should('not.exist');
    });
  });

  // GIVEN Alice is an admin and an open draft has Alice and Bob joined with lineups available
  // WHEN Alice clicks Start draft and chooses ABBA
  // THEN the draft starts with the randomized joined-user order alternating forward and backward each round for 3 picks per user
  it('allows an admin to start a two-user ABBA draft order', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('start-draft-button').click();
    cy.testGet('draft-order-mode-dialog').should('be.visible');
    cy.testGet('start-abba-draft-button').click();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 2);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob');
    assertTwoUserAbbaQueue();
  });

  // GIVEN Alice is an admin and an open draft has Alice, Bob, and Carol joined with lineups available
  // WHEN Alice clicks Start draft and chooses ABBA
  // THEN the draft starts with the randomized joined-user order alternating forward, backward, and forward for 3 picks per user
  it('allows an admin to start a three-user ABBA draft order', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob', 'Carol'], draftOrder: [], picks: [] });

    cy.visit(`/${alicePasskey}/matches/${match.id}/draft`);
    cy.testGet('start-draft-button').click();
    cy.testGet('draft-order-mode-dialog').should('be.visible');
    cy.testGet('start-abba-draft-button').click();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('draft-order').find('[data-test="draft-order-user"]').should('have.length', 3);
    cy.testGet('draft-order').should('contain.text', 'Alice').and('contain.text', 'Bob').and('contain.text', 'Carol');
    assertThreeUserAbbaQueue();
  });

  // GIVEN Alice is an admin and an open draft has at least two joined users with lineups available
  // WHEN Alice clicks Start draft and cancels the draft-order popup
  // THEN the draft remains open and no draft order is created
  it('keeps the draft open when an admin cancels the draft order mode popup', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

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
    setDraft({ status: 'started', joinedUsers: ['Alice', 'Bob'], draftOrder: ['Alice', 'Bob'], picks: [] });

    cy.visit(`/${carolPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft in progress');
      cy.testGet('join-draft-button').should('not.exist');
      cy.testGet('create-draft-button').should('not.exist');
    });
  });

  // GIVEN Alice is an admin and a draft exists with drafted decisions
  // WHEN Alice cancels the draft
  // THEN the draft is reset and previous drafted decisions are cleared
  it('allows an admin to cancel a draft and clear drafted decisions', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: [{ userName: 'Alice', playerName: alicePlayers[0] }]
    });

    cy.visit(`/${alicePasskey}`);
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

  // GIVEN Bob is a regular user and a draft exists
  // WHEN Bob opens the home page
  // THEN he does not see the Cancel draft button
  it('does not show regular users the cancel draft action', () => {
    setDraft({ status: 'started', joinedUsers: ['Alice', 'Bob'], draftOrder: ['Alice', 'Bob'], picks: [] });

    cy.visit(`/${bobPasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'Draft in progress');
      cy.testGet('cancel-draft-button').should('not.exist');
    });
  });

  // GIVEN Bob is a regular user and an upcoming match has no draft yet
  // WHEN Bob directly calls the create draft API
  // THEN the API rejects the request with 403 Forbidden
  it('rejects regular user draft creation through the API', () => {
    cy.request({
      method: 'POST',
      url: `/api/drafts/${match.id}`,
      body: { passkey: bobPasskey },
      failOnStatusCode: false
    }).its('status').should('equal', 403);
  });

  // GIVEN Bob is a regular user and an open draft has at least two joined users
  // WHEN Bob directly calls the start draft API
  // THEN the API rejects the request with 403 Forbidden
  it('rejects regular user draft start through the API', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.request({
      method: 'POST',
      url: `/api/drafts/${match.id}/start`,
      body: { passkey: bobPasskey },
      failOnStatusCode: false
    }).its('status').should('equal', 403);
  });

  // GIVEN Bob is a regular user and a draft exists
  // WHEN Bob directly calls the cancel draft API
  // THEN the API rejects the request with 403 Forbidden
  it('rejects regular user draft cancellation through the API', () => {
    setDraft({ status: 'started', joinedUsers: ['Alice', 'Bob'], draftOrder: ['Alice', 'Bob'], picks: [] });

    cy.request({
      method: 'DELETE',
      url: `/api/drafts/${match.id}?passkey=${encodeURIComponent(bobPasskey)}`,
      failOnStatusCode: false
    }).its('status').should('equal', 403);
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

  it('opens the live match page from a completed draft card', () => {
    setDraft({ status: 'completed', joinedUsers: ['Alice', 'Bob'], draftOrder: ['Alice', 'Bob'], picks: completedPicks });

    cy.visit(`/${bobPasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${match.id}/live`);
    cy.testGet('live-match-page').should('be.visible');
  });

  it('opens the live match results page from a completed draft card after the match ends', () => {
    setDraft({ status: 'completed', joinedUsers: ['Alice', 'Bob'], draftOrder: ['Alice', 'Bob'], picks: completedPicks });
    cy.setScraperMatchStatus(match.id, { started: true, finished: true });
    cy.request('POST', '/api/testing/live-matches/finalize-completed')
      .its('status')
      .should('equal', 204);

    cy.visit(`/${bobPasskey}`);
    showMatchDateTab();
    matchCard().click();

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${match.id}/live`);
    cy.testGet('live-match-result').should('be.visible').and('contain.text', 'Final result');
  });

  // GIVEN the local clock is past kickoff but the scraper still says the match has not started
  // WHEN Alice opens the home page
  // THEN draft actions remain based on the scraper status rather than the local kickoff time
  it('keeps draft actions available after kickoff time until the scraper says the match has started', () => {
    cy.clock(new Date(match.date).getTime() + 60 * 1000, ['Date']);

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
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
