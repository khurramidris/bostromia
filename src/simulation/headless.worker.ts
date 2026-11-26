import { runHeadless, type HeadlessOptions, type HeadlessResult } from './headless';

export interface HeadlessWorkerRequest {
  id: number;
  options: HeadlessOptions;
}

export interface HeadlessWorkerResponse {
  id: number;
  ok: true;
  result: HeadlessResult;
}

export interface HeadlessWorkerError {
  id: number;
  ok: false;
  error: string;
}

self.onmessage = (event: MessageEvent<HeadlessWorkerRequest>) => {
  const { id, options } = event.data;
  try {
    const result = runHeadless(options);
    const response: HeadlessWorkerResponse = { id, ok: true, result };
    self.postMessage(response);
  } catch (err) {
    const response: HeadlessWorkerError = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'Headless simulation failed.',
    };
    self.postMessage(response);
  }
};
