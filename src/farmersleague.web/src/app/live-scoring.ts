import { LivePlayer, PlayerStat, PlayerStatCategory } from './models';
import { liveStatPointMultipliers } from './scoring.config';

export function livePlayerPoints(player: LivePlayer | null) {
  if (!player) {
    return 0;
  }

  return uniqueLivePlayerStats(player)
    .reduce((total, stat) => total + liveStatPoints(stat), 0);
}

export function liveStatPoints(stat: PlayerStat) {
  return numericStatValue(stat.value) * (liveStatPointMultipliers[stat.key] ?? 0);
}

export function scoringLivePlayerCategories(player: LivePlayer): PlayerStatCategory[] {
  return player.categories
    .map((category) => ({
      ...category,
      stats: category.stats.filter((stat) => liveStatPoints(stat) !== 0)
    }))
    .filter((category) => category.stats.length > 0);
}

function numericStatValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function uniqueLivePlayerStats(player: LivePlayer) {
  const statsByKey = new Map<string, PlayerStat>();

  for (const stat of player.categories.flatMap((category) => category.stats)) {
    if (!statsByKey.has(stat.key)) {
      statsByKey.set(stat.key, stat);
    }
  }

  return [...statsByKey.values()];
}
