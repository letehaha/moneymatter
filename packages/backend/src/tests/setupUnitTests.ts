/**
 * Setup file for unit tests.
 * Mocks external dependencies like Redis to prevent connection attempts and sets
 * stable defaults for env vars that are read at module-evaluation time elsewhere
 * (e.g., `APPLICATION_JWT_SECRET` in `common/utils/encryption.ts`).
 */

if (!process.env.APPLICATION_JWT_SECRET) {
  process.env.APPLICATION_JWT_SECRET = 'unit-test-secret';
}

// `@models/index` constructs the Sequelize instance at module load; it needs a
// dialect and connection params even though unit tests never open a connection.
process.env.APPLICATION_DB_DIALECT ??= 'postgres';
process.env.APPLICATION_DB_HOST ??= 'localhost';
process.env.APPLICATION_DB_PORT ??= '5432';
process.env.APPLICATION_DB_USERNAME ??= 'postgres';
process.env.APPLICATION_DB_PASSWORD ??= 'postgres';
process.env.APPLICATION_DB_DATABASE ??= 'unit_tests';

// Mock the redis-client module to prevent actual Redis connections in unit tests
jest.mock('@root/redis-client', () => ({
  redisClient: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    mget: jest.fn().mockResolvedValue([]),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    status: 'ready',
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  },
  redisReady: Promise.resolve(),
  REDIS_KEY_PREFIX: undefined,
}));
