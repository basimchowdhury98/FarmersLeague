export type HelloResponse = {
  message: string;
};

export type MatchResponse = {
  id: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  lineups: LineupResponse[];
  draft?: DraftResponse | null;
  hasStarted?: boolean;
};

export type LineupResponse = {
  teamName: string;
  formation: string;
  starters: StarterResponse[];
  bench: StarterResponse[];
};

export type StarterResponse = {
  name: string;
  number: number | null;
  position: string | null;
  grid: string | null;
  gridRow: number | null;
  gridColumn: number | null;
};

export type AccessResponse = {
  hasAccess: boolean;
  userName: string;
};

export type DraftResponse = {
  match: MatchResponse;
  status: 'open' | 'started' | 'completed';
  joinedUsers: string[];
  draftOrder: string[];
  picks: DraftPick[];
  currentTurn: string | null;
  isComplete: boolean;
};

export type DraftPick = {
  userName: string;
  playerName: string;
};

export type DraftPickErrorResponse = {
  message: string;
};

export type DraftPickFlight = {
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

export type MatchFeedTab = 'past' | 'today' | 'upcoming';
