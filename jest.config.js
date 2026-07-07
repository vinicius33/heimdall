/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/apps'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@heimdall/core$': '<rootDir>/packages/core/src',
    '^@heimdall/linear$': '<rootDir>/packages/linear/src',
    '^@heimdall/github$': '<rootDir>/packages/github/src',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
