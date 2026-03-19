/**
 * Shared fetch wrapper with AbortController timeout.
 * Prevents indefinite hangs when backend is unreachable.
 */

import { config } from '../config';

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = config.apiTimeout,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
