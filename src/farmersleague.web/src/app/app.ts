import { HttpClient } from '@angular/common/http';
import { Component, signal } from '@angular/core';

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
};

type LineupResponse = {
  teamName: string;
  formation: string;
  starters: StarterResponse[];
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

const maxPicksPerUser = 3;

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
  protected readonly draft = signal<DraftResponse | null>(null);
  protected readonly draftError = signal('');
  protected readonly draftLiveError = signal('');
  protected readonly hasAccess = signal(false);
  protected readonly isCheckingAccess = signal(true);
  protected readonly passkey = signal('');
  protected readonly userName = signal('');
  protected readonly route = signal<'home' | 'draft'>('home');
  private draftSocket: WebSocket | null = null;

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
    });
  }

  protected openDraft(match: MatchResponse) {
    window.location.href = `/${this.passkey()}/matches/${match.id}/draft`;
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
        this.draft.set(response);
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
      draft.currentTurn !== this.userName() ||
      this.draftedBy(playerName) !== null ||
      this.userPickCount() >= maxPicksPerUser
    );
  }

  private loadDraft(matchId: number) {
    this.http.get<DraftResponse>(`/api/drafts/${matchId}`).subscribe((response) => {
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
      this.draft.set(JSON.parse(event.data) as DraftResponse);
    });

    socket.addEventListener('error', () => {
      this.draftLiveError.set('Live updates unavailable');
    });
  }
}
