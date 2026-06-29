const { createClient } = require('redis');

const normalizeDraft = (draft = {}) => {
  const draftOrder = draft.draftOrder ?? [];
  const joinedUsers = draft.joinedUsers?.length ? draft.joinedUsers : draftOrder;
  const picks = draft.picks ?? [];
  const draftTurnOrder = draft.draftTurnOrder?.length
    ? draft.draftTurnOrder
    : Array.from({ length: 3 }, () => draftOrder).flat();
  const status = draft.status ?? (draftOrder.length > 0 ? 'started' : 'open');

  return {
    status: draftTurnOrder.length > 0 && picks.length >= draftTurnOrder.length ? 'completed' : status,
    joinedUsers,
    draftOrder,
    draftTurnOrder,
    picks
  };
};

class RedisTestStateStore {
  constructor({ redisUrl, redisPrefix }) {
    this.redisUrl = redisUrl;
    this.redisPrefix = redisPrefix;
    this.homeMatchesKey = `${redisPrefix}matches:world-cup-2026`;
  }

  async resetHomeMatches() {
    return this.withRedis((client) => client.del(this.homeMatchesKey)).then(() => null);
  }

  async resetTestState() {
    return this.withRedis(async (client) => {
      const matches = await this.readHomeMatches(client);
      if (matches.length > 0) {
        await this.writeHomeMatches(client, matches.map((match) => ({
          ...match,
          hasStarted: false,
          hasFinished: false,
          score: null,
          draft: null
        })));
      }

      await this.deleteByPattern(client, `${this.redisPrefix}matches:*:lineups`);
      await this.deleteByPattern(client, `${this.redisPrefix}live-matches:*:completed`);
      return null;
    });
  }

  async setMatchStatus(matchId, status) {
    return this.updateHomeMatches((matches) => matches.map((match) => match.id === matchId
      ? {
          ...match,
          hasStarted: Boolean(status.started),
          hasFinished: Boolean(status.finished),
          score: status.score ?? null
        }
      : match));
  }

  async matchIsUpcoming(matchId) {
    return this.setMatchStatus(matchId, { started: false, finished: false, score: null });
  }

  async matchIsOngoing(matchId, { score = null } = {}) {
    return this.setMatchStatus(matchId, { started: true, finished: false, score });
  }

  async matchIsFinished(matchId, { score = null } = {}) {
    return this.setMatchStatus(matchId, { started: true, finished: true, score });
  }

  async clearDraft(matchId) {
    return this.updateHomeMatches((matches) => matches.map((match) => match.id === matchId ? { ...match, draft: null } : match));
  }

  async setDraft(matchId, draft) {
    return this.updateHomeMatches((matches) => matches.map((match) => match.id === matchId ? { ...match, draft: normalizeDraft(draft) } : match));
  }

  async openDraft(matchId, { joinedUsers }) {
    return this.setDraft(matchId, {
      status: 'open',
      joinedUsers,
      draftOrder: [],
      draftTurnOrder: [],
      picks: []
    });
  }

  async startedDraft(matchId, { joinedUsers, draftOrder, picks = [], draftTurnOrder = null }) {
    return this.setDraft(matchId, {
      status: 'started',
      joinedUsers,
      draftOrder,
      draftTurnOrder: draftTurnOrder ?? Array.from({ length: 3 }, () => draftOrder).flat(),
      picks
    });
  }

  async completedDraft(matchId, { joinedUsers, draftOrder, picks, draftTurnOrder = null }) {
    return this.setDraft(matchId, {
      status: 'completed',
      joinedUsers,
      draftOrder,
      draftTurnOrder: draftTurnOrder ?? Array.from({ length: 3 }, () => draftOrder).flat(),
      picks
    });
  }

  async clearCompletedLiveMatch(matchId) {
    return this.withRedis((client) => client.del(this.completedLiveMatchKey(matchId))).then(() => null);
  }

  async getCompletedLiveMatch(matchId) {
    return this.withRedis(async (client) => {
      const value = await this.getDistributedCacheString(client, this.completedLiveMatchKey(matchId));
      return value ? JSON.parse(value) : null;
    });
  }

  async setCompletedLiveMatch(matchId, completed) {
    return this.withRedis((client) => this.setDistributedCacheString(client, this.completedLiveMatchKey(matchId), JSON.stringify(completed))).then(() => null);
  }

  async updateHomeMatches(update) {
    return this.withRedis(async (client) => {
      const matches = await this.readHomeMatches(client);
      if (matches.length === 0) {
        return null;
      }

      await this.writeHomeMatches(client, update(matches));
      return null;
    });
  }

  async readHomeMatches(client) {
    const value = await this.getDistributedCacheString(client, this.homeMatchesKey);
    return value ? JSON.parse(value) : [];
  }

  writeHomeMatches(client, matches) {
    return this.setDistributedCacheString(client, this.homeMatchesKey, JSON.stringify(matches));
  }

  completedLiveMatchKey(matchId) {
    return `${this.redisPrefix}live-matches:${matchId}:completed`;
  }

  async withRedis(work) {
    const client = createClient({ url: this.redisUrl });
    await client.connect();

    try {
      return await work(client);
    } finally {
      await client.quit();
    }
  }

  async getDistributedCacheString(client, key) {
    const type = await client.type(key);
    if (type === 'none') {
      return null;
    }

    return type === 'hash' ? client.hGet(key, 'data') : client.get(key);
  }

  setDistributedCacheString(client, key, value) {
    return client.hSet(key, {
      absexp: '-1',
      sldexp: '-1',
      data: value
    });
  }

  async deleteByPattern(client, pattern) {
    let cursor = '0';

    do {
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = String(result.cursor);

      if (result.keys.length > 0) {
        await client.del(result.keys);
      }
    } while (cursor !== '0');
  }
}

module.exports = {
  RedisTestStateStore
};
