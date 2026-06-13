/**
 * As a logged-in FarmersLeague user, I want to see upcoming matches on my user home page, create or join draft lobbies before
 * lineups are available, and block starting drafts until confirmed lineups exist, so that the lobby can form early while
 * preventing drafts without the required player pool.
 */
describe('Upcoming match draft lobby', () => {
  const alicePasskey = '11111111-1111-1111-1111-111111111111';
  const bobPasskey = '22222222-2222-2222-2222-222222222222';
  const carolPasskey = '33333333-3333-3333-3333-333333333333';
  const fullBenchPlayerCount = 15;
  const lineupUnavailableMessage = 'No lineup available yet. Draft can\'t start until the starting lineup is available.';

  let match;
  let noLineupMatch;
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
            && lineups.every((lineup) => lineup.starters.length === 11 && lineup.bench.length === fullBenchPlayerCount);

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

  const matchCard = () => cy.contains('[data-test="match-card"]', matchLabel);
  const noLineupMatchCard = () => cy.contains('[data-test="match-card"]', noLineupMatchLabel);

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

  // GIVEN a logged-in user is on the home page and an upcoming match has no draft yet, even though its lineup is unavailable
  // WHEN the user clicks that match's Create draft button
  // THEN they are taken to that match's draft page with the draft open and themselves joined
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

  // GIVEN an open draft has at least two joined users and the scraper returns starting 11 plus bench for both teams
  // WHEN a joined user opens the draft page
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
