import { HttpClient } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';

type HelloResponse = {
  message: string;
};

type MatchResponse = {
  id: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  lineups: LineupResponse[];
  draft?: DraftResponse | null;
  hasStarted?: boolean;
};

type LineupResponse = {
  teamName: string;
  formation: string;
  starters: StarterResponse[];
  bench: StarterResponse[];
};

type StarterResponse = {
  name: string;
  number: number | null;
  position: string | null;
  grid: string | null;
  gridRow: number | null;
  gridColumn: number | null;
};

type AccessResponse = {
  hasAccess: boolean;
  userName: string;
};

type DraftResponse = {
  match: MatchResponse;
  status: 'open' | 'started' | 'completed';
  joinedUsers: string[];
  draftOrder: string[];
  picks: DraftPick[];
  currentTurn: string | null;
  isComplete: boolean;
};

type DraftPick = {
  userName: string;
  playerName: string;
};

type DraftPickErrorResponse = {
  message: string;
};

type DraftPickFlight = {
  id: number;
  userName: string;
  playerName: string;
  left: number;
  top: number;
  width: number;
  height: number;
  deltaX: number;
  deltaY: number;
};

type MatchFeedTab = 'past' | 'today' | 'upcoming';

const maxPicksPerUser = 3;
const fullBenchPlayerCount = 15;
const draftPickFlightDurationMs = 850;
const draftedHighlightDurationMs = 1100;

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
  protected readonly draftError = signal('');
  protected readonly draftLiveError = signal('');
  protected readonly draftPickFlight = signal<DraftPickFlight | null>(null);
  protected readonly recentlyDraftedPlayer = signal('');
  protected readonly hasAccess = signal(false);
  protected readonly isCheckingAccess = signal(true);
  protected readonly passkey = signal('');
  protected readonly userName = signal('');
  protected readonly route = signal<'home' | 'draft'>('home');
  private draftSocket: WebSocket | null = null;
  private draftPickFlightId = 0;
  private activeDraftPickFlightKey = '';
  private draftPickFlightTimeout: number | null = null;
  private draftedHighlightTimeout: number | null = null;

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

    if (draftMatch) {
      this.route.set('draft');
      this.loadDraft(Number(draftMatch[1]));
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

  protected startDraft() {
    const draft = this.draft();
    if (!draft) {
      return;
    }

    this.draftError.set('');
    this.http.post<DraftResponse>(`/api/drafts/${draft.match.id}/start`, { passkey: this.passkey() }).subscribe({
      next: (response) => this.applyDraftUpdate(response),
      error: (error) => {
        const response = error.error as DraftPickErrorResponse | undefined;
        this.draftError.set(response?.message ?? 'Unable to start draft');
      }
    });
  }

  protected matchDraftStatus(match: MatchResponse) {
    if (this.hasMatchStarted(match)) {
      return 'Match started';
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
    return !this.hasMatchStarted(match) && this.hasConfirmedFullSquads(match) && !match.draft;
  }

  protected canJoinDraft(match: MatchResponse) {
    return !this.hasMatchStarted(match) && this.hasConfirmedFullSquads(match) && match.draft?.status === 'open' && !match.draft.joinedUsers.includes(this.userName());
  }

  protected canCancelDraft(match: MatchResponse) {
    return !this.hasMatchStarted(match) && !!match.draft && !match.draft.isComplete && match.draft.status !== 'completed';
  }

  protected hasMatchStarted(match: MatchResponse) {
    return match.hasStarted === true || new Date(match.date).getTime() <= Date.now();
  }

  protected hasConfirmedFullSquads(match: MatchResponse) {
    return match.lineups.length >= 2 && match.lineups.every((lineup) => lineup.starters.length === 11 && (lineup.bench?.length ?? 0) === fullBenchPlayerCount);
  }

  protected canOpenDraft(match: MatchResponse) {
    return !!match.draft || this.hasConfirmedFullSquads(match);
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
        this.draftError.set(response?.message ?? 'Unable to draft player');
      }
    });
  }

  protected draftedBy(playerName: string) {
    return this.draft()?.picks.find((pick) => pick.playerName === playerName)?.userName ?? null;
  }

  protected picksFor(userName: string) {
    return this.draft()?.picks.filter((pick) => pick.userName === userName) ?? [];
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
    const totalTurns = draft.draftOrder.length * maxPicksPerUser;
    const remainingTurnCount = Math.max(totalTurns - draft.picks.length, 0);

    if (draft.isComplete || remainingTurnCount === 0 || draft.draftOrder.length === 0) {
      return [];
    }

    return Array.from({ length: remainingTurnCount }, (_, index) => draft.draftOrder[(draft.picks.length + index) % draft.draftOrder.length]);
  }

  protected turnQueueItemOpacity(index: number) {
    return Math.max(1 - index * 0.14, 0.32).toString();
  }

  protected isDraftButtonDisabled(playerName: string) {
    const draft = this.draft();

    return (
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

  private loadDraft(matchId: number) {
    this.http.get<DraftResponse>(`/api/drafts/${matchId}?passkey=${encodeURIComponent(this.passkey())}`).subscribe((response) => {
      this.draft.set(response);
      this.connectDraftLiveUpdates(matchId);
    });
  }

  private connectDraftLiveUpdates(matchId: number) {
    this.draftSocket?.close();
    this.draftLiveError.set('');

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/drafts/${matchId}/live?passkey=${encodeURIComponent(this.passkey())}`);
    this.draftSocket = socket;

    socket.addEventListener('message', (event) => {
      this.applyDraftUpdate(JSON.parse(event.data) as DraftResponse);
    });

    socket.addEventListener('error', () => {
      this.draftLiveError.set('Live updates unavailable');
    });
  }

  private applyDraftUpdate(response: DraftResponse) {
    const currentDraft = this.draft();
    if (!currentDraft) {
      this.draft.set(response);
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
}
