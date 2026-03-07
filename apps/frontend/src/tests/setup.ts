/// <reference types="node" />
// Setup para testes Vitest
// Conforme SP-FE-09

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, expect, vi } from 'vitest';

// Estender expect com matchers do jest-dom
expect.extend(matchers);

// Mock fetch para fixtures em ambiente de teste
beforeAll(() => {
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = vi.fn((url: string) => {
    // Extrair path do fixture
    const match = url.match(/\/fixtures\/(.+)/);
    if (match) {
      const fixturePath = match[1];
      const cwd = process.cwd();
      const base = cwd.endsWith('frontend') ? cwd : join(cwd, 'frontend');
      const fullPath = join(base, 'public', 'fixtures', fixturePath);
      try {
        const data = readFileSync(fullPath, 'utf-8');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(data)),
        } as Response);
      } catch {
        return Promise.resolve({
          ok: false,
          status: 404,
        } as Response);
      }
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as typeof fetch;
});

// Limpar após cada teste
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
