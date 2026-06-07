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
  protected readonly hasAccess = signal(false);
  protected readonly isCheckingAccess = signal(true);
  protected readonly passkey = signal('');
  protected readonly userName = signal('');
  protected readonly route = signal<'home' | 'draft'>('home');

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

  protected hasFormationGrid(lineup: LineupResponse) {
    return lineup.starters.every((starter) => starter.gridRow !== null && starter.gridColumn !== null);
  }

  protected userPickCount() {
    return this.picksFor(this.userName()).length;
  }

  protected isDraftButtonDisabled(playerName: string) {
    const draft = this.draft();

    return !draft || draft.isComplete || this.draftedBy(playerName) !== null || this.picksFor(this.userName()).length >= maxPicksPerUser;
  }

  private loadDraft(matchId: number) {
    this.http.get<DraftResponse>(`/api/drafts/${matchId}`).subscribe((response) => {
      this.draft.set(response);
    });
  }
}
