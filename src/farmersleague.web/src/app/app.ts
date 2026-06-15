import { HttpClient } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { draftedHighlightDurationMs, draftPickFlightDurationMs, fullBenchPlayerCount, lineupUnavailableMessage, liveMatchUnavailableMessage, maxPicksPerUser, startingPlayerCount } from './draft.constants';
import { livePlayerPoints, liveStatPoints, scoringLivePlayerCategories } from './live-scoring';
import { AccessResponse, DraftLiveMessage, DraftOrderMode, DraftOrderReveal, DraftOrderRevealMessage, DraftPick, DraftPickErrorResponse, DraftPickFlight, DraftResponse, HelloResponse, LineupResponse, LiveMatchResponse, LivePlayer, LiveSquad, MatchFeedTab, MatchResponse, PlayerStat, StarterResponse } from './models';

const liveMatchStartedError = 'Live match cannot be created since the actual match has started';

type LivePointChange = {
  id: number;
  playerName: string;
  delta: number;
};

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly maxPicksPerUser = maxPicksPerUser;
  protected readonly hello = signal('Loading API greeting...');
  protected readonly matches = signal<MatchResponse[]>([]);
  protected readonly matchesLoaded = signal(false);
  protected readonly homeError = signal('');
  protected readonly matchFeedTab = signal<MatchFeedTab>('upcoming');
  protected readonly upcomingDateIndex = signal(0);
  protected readonly upcomingDateKeys = computed(() => this.uniqueDateKeys(this.upcomingMatches()));
  protected readonly visibleMatches = computed(() => {
    if (this.matchFeedTab() === 'past') {
      return this.pastMatches();
    }

    if (this.matchFeedTab() === 'today') {
      return this.todayMatches();
    }

    const dateKey = this.activeUpcomingDateKey();
    return dateKey ? this.upcomingMatches().filter((match) => this.matchDateKey(match) === dateKey) : [];
  });
  protected readonly draft = signal<DraftResponse | null>(null);
  protected readonly liveMatch = signal<LiveMatchResponse | null>(null);
  protected readonly liveMatchUnavailable = signal('');
  protected readonly liveMatchLiveError = signal('');
  protected readonly selectedLivePlayer = signal<LivePlayer | null>(null);
  protected readonly livePointChanges = signal<LivePointChange[]>([]);
  protected readonly draftError = signal('');
  protected readonly draftLiveError = signal('');
  protected readonly draftPickFlight = signal<DraftPickFlight | null>(null);
  protected readonly draftOrderReveal = signal<DraftOrderReveal | null>(null);
  protected readonly recentlyDraftedPlayer = signal('');
  protected readonly isDraftOrderModeDialogOpen = signal(false);
  protected readonly hasAccess = signal(false);
  protected readonly isCheckingAccess = signal(true);
  protected readonly passkey = signal('');
  protected readonly userName = signal('');
  protected readonly isAdmin = signal(false);
  protected readonly route = signal<'home' | 'draft' | 'live'>('home');
  private draftSocket: WebSocket | null = null;
  private liveMatchSocket: WebSocket | null = null;
  private draftPickFlightId = 0;
  private livePointChangeId = 0;
  private activeDraftPickFlightKey = '';
  private draftPickFlightTimeout: number | null = null;
  private draftedHighlightTimeout: number | null = null;
  private livePointChangeTimeouts = new Map<number, number>();

  constructor(private readonly http: HttpClient) {
    const passkey = window.location.pathname.split('/').filter(Boolean)[0];
    this.passkey.set(passkey ?? '');

    if (!passkey) {
      this.isCheckingAccess.set(false);
      return;
    }

    http.get<AccessResponse>(`/api/access/${passkey}`).subscribe({
      next: (response) => {
        this.hasAccess.set(true);
        this.userName.set(response.userName);
        this.isAdmin.set(response.isAdmin);
        this.isCheckingAccess.set(false);

        this.loadCurrentRoute();
      },
      error: () => {
        this.isCheckingAccess.set(false);
      }
    });
  }

  private loadCurrentRoute() {
    const draftMatch = window.location.pathname.match(/^\/[^/]+\/matches\/(\d+)\/draft$/);
    const liveMatch = window.location.pathname.match(/^\/[^/]+\/matches\/(\d+)\/live$/);

    if (draftMatch) {
      this.route.set('draft');
      this.loadDraft(Number(draftMatch[1]));
      return;
    }

    if (liveMatch) {
      this.route.set('live');
      this.loadLiveMatch(Number(liveMatch[1]));
      return;
    }

    this.route.set('home');
    this.loadHomePage();
  }

  private loadHomePage() {
    this.http.get<HelloResponse>('/api/hello').subscribe((response) => {
      this.hello.set(response.message);
    });

    this.http.get<MatchResponse[]>('/api/matches').subscribe((response) => {
      this.matches.set(response);
      this.matchesLoaded.set(true);
      this.selectDefaultMatchFeedTab();
    });
  }

  private selectDefaultMatchFeedTab() {
    if (this.upcomingMatches().length > 0) {
      this.matchFeedTab.set('upcoming');
      this.upcomingDateIndex.set(0);
      return;
    }

    if (this.todayMatches().length > 0) {
      this.matchFeedTab.set('today');
      return;
    }

    this.matchFeedTab.set('past');
  }

  protected setMatchFeedTab(tab: MatchFeedTab) {
    this.matchFeedTab.set(tab);
    if (tab === 'upcoming') {
      this.upcomingDateIndex.set(Math.min(this.upcomingDateIndex(), Math.max(this.upcomingDateKeys().length - 1, 0)));
    }
  }

  protected showPreviousUpcomingDate() {
    this.upcomingDateIndex.set(Math.max(this.upcomingDateIndex() - 1, 0));
  }

  protected showNextUpcomingDate() {
    this.upcomingDateIndex.set(Math.min(this.upcomingDateIndex() + 1, Math.max(this.upcomingDateKeys().length - 1, 0)));
  }

  protected activeUpcomingDateText() {
    const dateKey = this.activeUpcomingDateKey();
    return dateKey ? this.dateKeyText(dateKey) : 'No upcoming dates';
  }

  protected canShowPreviousUpcomingDate() {
    return this.upcomingDateIndex() > 0;
  }

  protected canShowNextUpcomingDate() {
    return this.upcomingDateIndex() < this.upcomingDateKeys().length - 1;
  }

  protected matchFeedTitle() {
    if (this.matchFeedTab() === 'past') {
      return 'Past Games';
    }

    if (this.matchFeedTab() === 'today') {
      return 'Today\'s Games';
    }

    return `Upcoming Games · ${this.activeUpcomingDateText()}`;
  }

  protected matchFeedEmptyText() {
    if (!this.matchesLoaded()) {
      return 'Loading matches...';
    }

    if (this.matchFeedTab() === 'past') {
      return 'No past matches yet.';
    }

    if (this.matchFeedTab() === 'today') {
      return 'No matches today.';
    }

    return 'No upcoming matches.';
  }

  protected openDraft(match: MatchResponse) {
    if (!this.canOpenDraft(match)) {
      return;
    }

    window.location.href = `/${this.passkey()}/matches/${match.id}/draft`;
  }

  private openLiveMatch(matchId: number) {
    window.location.href = `/${this.passkey()}/matches/${matchId}/live`;
  }

  protected createDraft(match: MatchResponse, event?: Event) {
    event?.stopPropagation();
    this.http.post<DraftResponse>(`/api/drafts/${match.id}`, { passkey: this.passkey() }).subscribe(() => {
      this.openDraft(match);
    });
  }

  protected joinDraft(match: MatchResponse, event?: Event) {
    event?.stopPropagation();
    this.http.post<DraftResponse>(`/api/drafts/${match.id}/join`, { passkey: this.passkey() }).subscribe(() => {
      this.openDraft(match);
    });
  }

  protected cancelDraft(match: MatchResponse, event?: Event) {
    event?.stopPropagation();
    this.http.delete(`/api/drafts/${match.id}?passkey=${encodeURIComponent(this.passkey())}`).subscribe(() => {
      this.loadHomePage();
    });
  }

  protected openDraftOrderModeDialog() {
    this.isDraftOrderModeDialogOpen.set(true);
  }

  protected closeDraftOrderModeDialog() {
    this.isDraftOrderModeDialogOpen.set(false);
  }

  protected startDraft(draftOrderMode: DraftOrderMode) {
    const draft = this.draft();
    if (!draft) {
      return;
    }

    this.draftError.set('');
    this.http.post<DraftResponse>(`/api/drafts/${draft.match.id}/start`, { passkey: this.passkey(), draftOrderMode }).subscribe({
      next: () => {
        this.closeDraftOrderModeDialog();
        // The reveal is synchronized for everyone by the websocket broadcast.
      },
      error: (error) => {
        const response = error.error as DraftPickErrorResponse | undefined;
        this.draftError.set(response?.message ?? 'Unable to start draft');
      }
    });
  }

  protected matchDraftStatus(match: MatchResponse) {
    if (this.hasMatchFinished(match)) {
      return 'Match ended';
    }

    if (this.hasMatchStarted(match)) {
      return 'Match ongoing';
    }

    if (!match.draft) {
      return '';
    }

    if (match.draft.isComplete || match.draft.status === 'completed') {
      return 'Draft complete';
    }

    return match.draft.status === 'open' ? 'Draft open' : 'Draft in progress';
  }

  protected canCreateDraft(match: MatchResponse) {
    return this.canManageDraftLifecycle() && !this.hasMatchStartedOrFinished(match) && !match.draft;
  }

  protected canJoinDraft(match: MatchResponse) {
    return !this.hasMatchStartedOrFinished(match) && match.draft?.status === 'open' && !match.draft.joinedUsers.includes(this.userName());
  }

  protected canCancelDraft(match: MatchResponse) {
    return this.canManageDraftLifecycle() && !this.hasMatchStartedOrFinished(match) && !!match.draft && !match.draft.isComplete && match.draft.status !== 'completed';
  }

  protected hasMatchStarted(match: MatchResponse) {
    return match.hasStarted === true;
  }

  protected hasMatchFinished(match: MatchResponse) {
    return match.hasFinished === true;
  }

  protected hasMatchStartedOrFinished(match: MatchResponse) {
    return this.hasMatchStarted(match) || this.hasMatchFinished(match);
  }

  protected canOpenDraft(match: MatchResponse) {
    return !this.hasMatchStartedOrFinished(match) || !!match.draft;
  }

  protected hasConfirmedFullSquads(match: MatchResponse) {
    return match.lineups.length >= 2
      && match.lineups.every((lineup) => lineup.starters.length === startingPlayerCount && lineup.bench.length === fullBenchPlayerCount);
  }

  protected lineupUnavailableMessage() {
    return lineupUnavailableMessage;
  }

  protected liveMatchUnavailableMessage() {
    return liveMatchUnavailableMessage;
  }

  protected canStartDraft(draft: DraftResponse) {
    return this.canManageDraftLifecycle() && !this.hasMatchStartedOrFinished(draft.match) && draft.joinedUsers.length >= 2 && this.hasConfirmedFullSquads(draft.match);
  }

  protected canShowStartDraft(draft: DraftResponse) {
    return this.canManageDraftLifecycle() && draft.joinedUsers.includes(this.userName());
  }

  private canManageDraftLifecycle() {
    return this.isAdmin();
  }

  protected kickoffText(match: MatchResponse) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(match.date));
  }

  protected homeGreeting() {
    return this.userName() ? `Welcome back, ${this.userName()}` : 'World Cup draft room';
  }

  protected shortKickoffText(match: MatchResponse) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(match.date));
  }

  protected matchFeedTabLabel() {
    if (this.matchFeedTab() === 'past') {
      return 'Past';
    }

    if (this.matchFeedTab() === 'today') {
      return 'Today';
    }

    return 'Upcoming';
  }

  protected teamInitials(teamName: string) {
    return teamName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  }

  private pastMatches() {
    const todayKey = this.dateKey(new Date());
    return this.matches()
      .filter((match) => this.matchDateKey(match) < todayKey)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private todayMatches() {
    const todayKey = this.dateKey(new Date());
    return this.matches()
      .filter((match) => this.matchDateKey(match) === todayKey)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private upcomingMatches() {
    const todayKey = this.dateKey(new Date());
    return this.matches()
      .filter((match) => this.matchDateKey(match) > todayKey)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private activeUpcomingDateKey() {
    return this.upcomingDateKeys()[this.upcomingDateIndex()] ?? null;
  }

  private uniqueDateKeys(matches: MatchResponse[]) {
    return [...new Set(matches.map((match) => this.matchDateKey(match)))];
  }

  private matchDateKey(match: MatchResponse) {
    return this.dateKey(new Date(match.date));
  }

  private dateKey(date: Date) {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  private dateKeyText(dateKey: string) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day));
  }

  protected draftPlayer(playerName: string) {
    const draft = this.draft();
    if (!draft) {
      return;
    }

    this.draftError.set('');

    this.http.post<DraftResponse>(`/api/drafts/${draft.match.id}/picks`, {
      passkey: this.passkey(),
      playerName
    }).subscribe({
      next: (response) => {
        this.applyDraftUpdate(response);
      },
      error: (error) => {
        const response = error.error as DraftPickErrorResponse | undefined;
        const message = response?.message ?? 'Unable to draft player';
        if (message === liveMatchStartedError) {
          this.navigateHomeWithError(message);
          return;
        }

        this.draftError.set(message);
      }
    });
  }

  protected draftedBy(playerName: string) {
    return this.draft()?.picks.find((pick) => pick.playerName === playerName)?.userName ?? null;
  }

  protected picksFor(userName: string) {
    return this.draft()?.picks.filter((pick) => pick.userName === userName) ?? [];
  }

  protected liveSquads() {
    const liveMatch = this.liveMatch();
    if (!liveMatch) {
      return [];
    }

    return [...liveMatch.squads].sort((left, right) => {
      if (left.userName === this.userName()) {
        return -1;
      }

      if (right.userName === this.userName()) {
        return 1;
      }

      return 0;
    });
  }

  protected isCurrentUserSquad(squad: LiveSquad) {
    return squad.userName === this.userName();
  }

  protected livePlayerOwner(playerName: string) {
    return this.liveMatch()?.squads.find((squad) => squad.players.some((player) => player.name === playerName))?.userName ?? null;
  }

  protected livePlayerByName(playerName: string) {
    return this.liveMatch()?.squads.flatMap((squad) => squad.players).find((player) => player.name === playerName) ?? null;
  }

  protected isLivePlayerCurrentUser(playerName: string) {
    return this.livePlayerOwner(playerName) === this.userName();
  }

  protected livePlayerPoints(player: LivePlayer | null) {
    return livePlayerPoints(player);
  }

  protected livePlayerPointsByName(playerName: string) {
    return this.livePlayerPoints(this.livePlayerByName(playerName));
  }

  protected livePointChangesForPlayer(playerName: string) {
    return this.livePointChanges().filter((change) => change.playerName === playerName);
  }

  protected liveSquadPoints(squad: LiveSquad) {
    return squad.players.reduce((total, player) => total + this.livePlayerPoints(player), 0);
  }

  protected liveStatPoints(stat: PlayerStat) {
    return liveStatPoints(stat);
  }

  protected livePointChangeText(delta: number) {
    return `${delta > 0 ? '+' : ''}${delta} pts`;
  }

  protected scoringLivePlayerCategories(player: LivePlayer) {
    return scoringLivePlayerCategories(player);
  }

  protected openLivePlayerStats(playerName: string) {
    const player = this.livePlayerByName(playerName);
    if (player) {
      this.selectedLivePlayer.set(player);
    }
  }

  protected closeLivePlayerStats() {
    this.selectedLivePlayer.set(null);
  }

  protected playerStatValue(stat: PlayerStat) {
    if (stat.value === null || stat.value === undefined || stat.value === '') {
      return '—';
    }

    return `${stat.value}`;
  }

  protected formationRows(lineup: LineupResponse, invertRows = false) {
    const grouped = new Map<number, StarterResponse[]>();

    for (const starter of lineup.starters) {
      if (starter.gridRow === null || starter.gridColumn === null) {
        continue;
      }

      grouped.set(starter.gridRow, [...(grouped.get(starter.gridRow) ?? []), starter]);
    }

    const rows = [...grouped.entries()]
      .sort(([rowA], [rowB]) => rowA - rowB)
      .map(([, starters]) => starters.sort((a, b) => (a.gridColumn ?? 0) - (b.gridColumn ?? 0)));

    return invertRows ? rows.reverse() : rows;
  }

  protected displayedLineupRows(lineup: LineupResponse, invertRows = false) {
    return this.hasFormationGrid(lineup) ? this.formationRows(lineup, invertRows) : [lineup.starters];
  }

  protected hasFormationGrid(lineup: LineupResponse) {
    return lineup.starters.every((starter) => starter.gridRow !== null && starter.gridColumn !== null);
  }

  protected userPickCount() {
    return this.picksFor(this.userName()).length;
  }

  protected remainingTurns(draft: DraftResponse) {
    const draftTurns = this.draftTurns(draft);
    const remainingTurnCount = Math.max(draftTurns.length - draft.picks.length, 0);

    if (draft.isComplete || remainingTurnCount === 0 || draftTurns.length === 0) {
      return [];
    }

    return draftTurns.slice(draft.picks.length);
  }

  private draftTurns(draft: DraftResponse) {
    return draft.draftTurnOrder.length > 0 ? draft.draftTurnOrder : this.roundRobinDraftTurns(draft.draftOrder);
  }

  private roundRobinDraftTurns(draftOrder: string[]) {
    return Array.from({ length: draftOrder.length * maxPicksPerUser }, (_, index) => draftOrder[index % draftOrder.length]);
  }

  protected turnQueueItemOpacity(index: number) {
    return Math.max(1 - index * 0.14, 0.32).toString();
  }

  protected isDraftButtonDisabled(playerName: string) {
    const draft = this.draft();

    return (
      this.draftOrderReveal() !== null ||
      !draft ||
      draft.isComplete ||
      draft.status !== 'started' ||
      draft.currentTurn !== this.userName() ||
      this.draftedBy(playerName) !== null ||
      this.userPickCount() >= maxPicksPerUser
    );
  }

  protected isRecentlyDrafted(playerName: string) {
    return this.recentlyDraftedPlayer() === playerName;
  }

  protected canControlDraftOrderReveal() {
    return this.isAdmin();
  }

  protected isDraftOrderRevealComplete(reveal: DraftOrderReveal) {
    return reveal.slots.every((slot) => slot.isRevealed);
  }

  protected showNextDraftOrderRevealSlot() {
    const reveal = this.draftOrderReveal();
    if (!reveal || this.isDraftOrderRevealComplete(reveal)) {
      return;
    }

    this.sendDraftLiveMessage({
      type: 'draftOrderRevealNext',
      revealedCount: reveal.slots.filter((slot) => slot.isRevealed).length + 1
    });
  }

  protected skipDraftOrderReveal() {
    this.sendDraftLiveMessage({ type: 'draftOrderRevealSkip' });
  }

  protected completeDraftOrderReveal() {
    this.sendDraftLiveMessage({ type: 'draftOrderRevealComplete' });
  }

  private loadDraft(matchId: number) {
    this.http.get<DraftResponse>(`/api/drafts/${matchId}?passkey=${encodeURIComponent(this.passkey())}`).subscribe((response) => {
      this.draft.set(response);
      this.connectDraftLiveUpdates(matchId);
    });
  }

  private navigateHomeWithError(message: string) {
    this.draftSocket?.close();
    this.liveMatchSocket?.close();
    this.draft.set(null);
    this.liveMatch.set(null);
    this.homeError.set(message);
    this.route.set('home');
    window.history.pushState({}, '', `/${this.passkey()}`);
    this.loadHomePage();
  }

  private loadLiveMatch(matchId: number) {
    this.draftSocket?.close();
    this.liveMatch.set(null);
    this.clearLivePointChanges();
    this.liveMatchUnavailable.set('');
    this.liveMatchLiveError.set('');

    this.http.get<LiveMatchResponse>(`/api/matches/${matchId}/live?passkey=${encodeURIComponent(this.passkey())}`).subscribe({
      next: (response) => {
        this.applyLiveMatchUpdate(response);
        this.connectLiveMatchUpdates(matchId);
      },
      error: (error) => {
        const response = error.error as DraftPickErrorResponse | undefined;
        this.liveMatchUnavailable.set(response?.message ?? liveMatchUnavailableMessage);
      }
    });
  }

  private connectLiveMatchUpdates(matchId: number) {
    this.liveMatchSocket?.close();
    this.liveMatchLiveError.set('');

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/matches/${matchId}/live/updates?passkey=${encodeURIComponent(this.passkey())}`);
    this.liveMatchSocket = socket;

    socket.addEventListener('message', (event) => {
      this.applyLiveMatchUpdate(JSON.parse(event.data) as LiveMatchResponse);
    });

    socket.addEventListener('error', () => {
      this.liveMatchLiveError.set('Live match updates unavailable');
    });
  }

  private applyLiveMatchUpdate(response: LiveMatchResponse) {
    const selectedPlayerName = this.selectedLivePlayer()?.name;
    const currentLiveMatch = this.liveMatch();
    if (currentLiveMatch) {
      this.recordLivePointChanges(currentLiveMatch, response);
    }

    this.liveMatch.set(response);

    if (selectedPlayerName) {
      this.selectedLivePlayer.set(this.livePlayerByName(selectedPlayerName));
    }
  }

  private recordLivePointChanges(currentLiveMatch: LiveMatchResponse, nextLiveMatch: LiveMatchResponse) {
    const currentPoints = new Map(
      currentLiveMatch.squads
        .flatMap((squad) => squad.players)
        .map((player) => [player.name, livePlayerPoints(player)])
    );

    const changes = nextLiveMatch.squads
      .flatMap((squad) => squad.players)
      .map((player) => ({ playerName: player.name, delta: livePlayerPoints(player) - (currentPoints.get(player.name) ?? livePlayerPoints(player)) }))
      .filter((change) => change.delta !== 0)
      .map((change) => ({ ...change, id: ++this.livePointChangeId }));

    if (changes.length === 0) {
      return;
    }

    this.livePointChanges.update((currentChanges) => [...currentChanges, ...changes]);

    for (const change of changes) {
      const timeout = window.setTimeout(() => {
        this.livePointChanges.update((currentChanges) => currentChanges.filter((currentChange) => currentChange.id !== change.id));
        this.livePointChangeTimeouts.delete(change.id);
      }, 2200);
      this.livePointChangeTimeouts.set(change.id, timeout);
    }
  }

  private clearLivePointChanges() {
    for (const timeout of this.livePointChangeTimeouts.values()) {
      window.clearTimeout(timeout);
    }

    this.livePointChangeTimeouts.clear();
    this.livePointChanges.set([]);
  }

  private connectDraftLiveUpdates(matchId: number) {
    this.draftSocket?.close();
    this.liveMatchSocket?.close();
    this.draftLiveError.set('');

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/drafts/${matchId}/live?passkey=${encodeURIComponent(this.passkey())}`);
    this.draftSocket = socket;

    socket.addEventListener('message', (event) => {
      this.applyDraftLiveMessage(JSON.parse(event.data) as DraftLiveMessage);
    });

    socket.addEventListener('error', () => {
      this.draftLiveError.set('Live updates unavailable');
    });
  }

  private applyDraftLiveMessage(message: DraftLiveMessage) {
    if ('type' in message) {
      if (message.type === 'draftOrderReveal') {
        this.applyDraftOrderRevealMessage(message);
      } else if (message.type === 'draftOrderRevealComplete') {
        this.draftOrderReveal.set(null);
      }

      return;
    }

    this.applyDraftUpdate(message);
  }

  private applyDraftUpdate(response: DraftResponse) {
    const currentDraft = this.draft();
    if (!currentDraft) {
      this.draft.set(response);
      return;
    }

    if (!currentDraft.isComplete && response.isComplete) {
      this.openLiveMatch(response.match.id);
      return;
    }

    if (currentDraft.status === 'started' && response.status === 'open' && response.joinedUsers.length === 0) {
      this.navigateHomeWithError(liveMatchStartedError);
      return;
    }

    const isDraftStart = currentDraft.status === 'open' && response.status === 'started' && response.draftOrder.length > 0;
    if (isDraftStart) {
      this.draft.set(response);
      this.startDraftOrderReveal(response);
      return;
    }

    const newPick = this.newDraftPick(currentDraft, response);
    if (!newPick) {
      if (!this.isActiveDraftPickFlight(response)) {
        this.draft.set(response);
      }

      return;
    }

    const flightKey = this.draftPickKey(newPick);
    if (flightKey === this.activeDraftPickFlightKey) {
      return;
    }

    const flight = this.createDraftPickFlight(newPick);
    if (!flight) {
      this.draft.set(response);
      this.highlightDraftedPlayer(newPick.playerName);
      return;
    }

    this.clearDraftPickFlightTimeout();
    this.activeDraftPickFlightKey = flightKey;
    this.draftPickFlight.set(flight);

    this.draftPickFlightTimeout = window.setTimeout(() => {
      this.draft.set(response);
      this.draftPickFlight.set(null);
      this.activeDraftPickFlightKey = '';
      this.draftPickFlightTimeout = null;
      this.highlightDraftedPlayer(newPick.playerName);
    }, draftPickFlightDurationMs);
  }

  private newDraftPick(currentDraft: DraftResponse, nextDraft: DraftResponse) {
    if (nextDraft.picks.length !== currentDraft.picks.length + 1) {
      return null;
    }

    const currentPickKeys = new Set(currentDraft.picks.map((pick) => this.draftPickKey(pick)));
    return nextDraft.picks.find((pick) => !currentPickKeys.has(this.draftPickKey(pick))) ?? null;
  }

  private isActiveDraftPickFlight(response: DraftResponse) {
    return response.picks.some((pick) => this.draftPickKey(pick) === this.activeDraftPickFlightKey);
  }

  private createDraftPickFlight(pick: DraftPick): DraftPickFlight | null {
    const source = this.findElementByAttribute('data-draft-turn-user', pick.userName);
    const target = this.findElementByAttribute('data-draft-player-name', pick.playerName);

    if (!source || !target) {
      return null;
    }

    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();

    return {
      id: ++this.draftPickFlightId,
      userName: pick.userName,
      playerName: pick.playerName,
      left: sourceBox.left,
      top: sourceBox.top,
      width: sourceBox.width,
      height: sourceBox.height,
      deltaX: targetBox.left + targetBox.width / 2 - (sourceBox.left + sourceBox.width / 2),
      deltaY: targetBox.top + targetBox.height / 2 - (sourceBox.top + sourceBox.height / 2)
    };
  }

  private findElementByAttribute(attributeName: string, value: string) {
    return [...document.querySelectorAll<HTMLElement>(`[${attributeName}]`)].find(
      (element) => element.getAttribute(attributeName) === value
    ) ?? null;
  }

  private draftPickKey(pick: DraftPick) {
    return `${pick.userName}\u0000${pick.playerName}`;
  }

  private highlightDraftedPlayer(playerName: string) {
    window.clearTimeout(this.draftedHighlightTimeout ?? undefined);
    this.recentlyDraftedPlayer.set(playerName);
    this.draftedHighlightTimeout = window.setTimeout(() => {
      this.recentlyDraftedPlayer.set('');
      this.draftedHighlightTimeout = null;
    }, draftedHighlightDurationMs);
  }

  private clearDraftPickFlightTimeout() {
    if (this.draftPickFlightTimeout === null) {
      return;
    }

    window.clearTimeout(this.draftPickFlightTimeout);
    this.draftPickFlightTimeout = null;
  }

  private startDraftOrderReveal(draft: DraftResponse) {
    this.draftOrderReveal.set({
      modeLabel: this.draftOrderModeLabel(draft),
      slots: draft.draftOrder.map((userName) => ({ userName, isRevealed: false }))
    });
  }

  private applyDraftOrderRevealMessage(message: DraftOrderRevealMessage) {
    this.draftOrderReveal.update((reveal) => reveal
      ? {
          ...reveal,
          slots: reveal.slots.map((slot, index) => ({ ...slot, isRevealed: index < message.revealedCount }))
        }
      : reveal);
  }

  private draftOrderModeLabel(draft: DraftResponse) {
    const abbaTurns = this.createDraftTurnOrder(draft.draftOrder, 'abba');
    return this.areSameOrder(draft.draftTurnOrder, abbaTurns) ? 'ABBA' : 'Round robin';
  }

  private createDraftTurnOrder(draftOrder: string[], mode: DraftOrderMode) {
    return Array.from({ length: maxPicksPerUser }).flatMap((_, round) => (
      mode === 'abba' && round % 2 === 1 ? [...draftOrder].reverse() : draftOrder
    ));
  }

  private areSameOrder(left: string[], right: string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  private sendDraftLiveMessage(message: object) {
    if (this.draftSocket?.readyState === WebSocket.OPEN) {
      this.draftSocket.send(JSON.stringify(message));
    }
  }
}
