/**
 * Vitest global setup.
 *
 * Starts a shared MSW server for all tests. Handlers are added per-test
 * via `server.use(...)` so the default state is "no handlers" — every
 * unmocked HTTP call will fail the test explicitly instead of hitting
 * the real API by accident.
 */

import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

export const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
