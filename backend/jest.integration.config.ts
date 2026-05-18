import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/tests/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/tests/integration/setup.ts'],
  globalSetup: '<rootDir>/tests/integration/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/integration/globalTeardown.ts',
  clearMocks: true,
  verbose: true,
  testTimeout: 30000,
};

export default config;
