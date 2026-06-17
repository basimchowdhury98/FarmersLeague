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
  hasFinished?: boolean;
  score?: string | null;
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
  isAdmin: boolean;
};

export type DraftResponse = {
  match: MatchResponse;
  status: 'open' | 'started' | 'completed';
  joinedUsers: string[];
  draftOrder: string[];
  draftTurnOrder: string[];
  picks: DraftPick[];
  currentTurn: string | null;
  isComplete: boolean;
};

export type DraftOrderMode = 'roundRobin' | 'abba';

export type DraftPick = {
  userName: string;
  playerName: string;
};

export type DraftPickErrorResponse = {
  message: string;
};

export type LiveMatchResponse = {
  match: MatchResponse;
  squads: LiveSquad[];
  finalResult: LiveMatchFinalResult | null;
};

export type LiveMatchFinalResult = {
  winners: string[];
  squads: LiveSquadFinalScore[];
  finalizedAt: string;
};

export type LiveSquadFinalScore = {
  userName: string;
  totalPoints: number;
};

export type LiveSquad = {
  userName: string;
  players: LivePlayer[];
};

export type LivePlayer = {
  name: string;
  teamName: string | null;
  categories: PlayerStatCategory[];
};

export type PlayerStatCategory = {
  key: string;
  title: string;
  stats: PlayerStat[];
};

export type PlayerStat = {
  key: string;
  label: string;
  sourceGroup: string | null;
  value: unknown;
  total: unknown;
  type: string | null;
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

export type DraftOrderReveal = {
  modeLabel: string;
  slots: DraftOrderRevealSlot[];
};

export type DraftOrderRevealSlot = {
  userName: string;
  isRevealed: boolean;
};

export type DraftLiveMessage = DraftUpdateMessage | DraftOrderRevealMessage | DraftOrderRevealCompleteMessage;

export type DraftUpdateMessage = {
  type: 'draftUpdate';
  status: 'open' | 'started' | 'completed';
  joinedUsers: string[];
  draftOrder: string[];
  draftTurnOrder: string[];
  picks: DraftPick[];
  currentTurn: string | null;
  isComplete: boolean;
};

export type DraftOrderRevealMessage = {
  type: 'draftOrderReveal';
  revealedCount: number;
};

export type DraftOrderRevealCompleteMessage = {
  type: 'draftOrderRevealComplete';
};

export type MatchFeedTab = 'past' | 'today' | 'upcoming';
