import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library cannot register its automatic cleanup; unmount
// everything rendered by a test here (calling cleanup() again in a test file is harmless).
afterEach(() => {
  cleanup();
});
