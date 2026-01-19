import { vi } from 'vitest';

// Mock console to reduce noise during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
