export interface RestoreResponse {
  code?: number;
  message?: string;
}

export interface WaitForLocalApiOptions {
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export const shouldClearStoredSession = (response: RestoreResponse | undefined | null): boolean => {
  return response?.code === 401;
};

export const waitForLocalApi = async (
  checkHealth: () => Promise<unknown>,
  options: WaitForLocalApiOptions = {},
): Promise<boolean> => {
  const timeoutMs = options.timeoutMs ?? 15000;
  const intervalMs = options.intervalMs ?? 300;
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? sleep;
  const startedAt = now();

  while (true) {
    try {
      await checkHealth();
      return true;
    } catch {
      if (now() - startedAt >= timeoutMs) {
        return false;
      }
      await delay(intervalMs);
    }
  }
};
