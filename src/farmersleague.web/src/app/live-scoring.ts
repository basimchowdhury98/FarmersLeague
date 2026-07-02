import { LivePlayer, PlayerStat, PlayerStatCategory } from './models';

export function livePlayerPoints(player: LivePlayer | null) {
  if (!player) {
    return 0;
  }

  if (player.pointsOverride !== null && player.pointsOverride !== undefined) {
    return player.pointsOverride;
  }

  return uniqueLivePlayerStats(player)
    .reduce((total, stat) => total + liveStatPoints(stat), 0);
}

export function liveStatPoints(stat: PlayerStat) {
  return stat.points;
}

export function scoringLivePlayerCategories(player: LivePlayer): PlayerStatCategory[] {
  return player.categories
    .map((category) => ({
      ...category,
      stats: category.stats.filter((stat) => liveStatPoints(stat) !== 0)
    }))
    .filter((category) => category.stats.length > 0);
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
