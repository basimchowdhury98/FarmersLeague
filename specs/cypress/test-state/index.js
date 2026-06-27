const { RedisTestStateStore } = require('./redis-test-state-store');

const createTestStateStore = () => new RedisTestStateStore({
  redisUrl: process.env.CYPRESS_REDIS_URL ?? 'redis://localhost:6379',
  redisPrefix: process.env.CYPRESS_REDIS_PREFIX ?? 'FarmersLeague:'
});

module.exports = {
  createTestStateStore
};
