import { useCallback, useRef, useState } from 'react';
import type { SAConfig, SAInput, SAResult } from '../lib/engine';
import type { WorkerRequest, WorkerResponse } from '../workers/scheduling-worker';

interface UseSchedulingWorkerReturn {
  /** Run SA in Web Worker. Returns promise with result. */
  runSA: (input: SAInput, config?: Partial<SAConfig>) => Promise<SAResult>;
  /** Current progress (0-100), null when idle */
  progress: number | null;
  /** Whether SA is currently running */
  isRunning: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Cancel the running SA */
  cancel: () => void;
}

export function useSchedulingWorker(): UseSchedulingWorkerReturn {
  const [progress, setProgress] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setIsRunning(false);
      setProgress(null);
    }
  }, []);

  const runSA = useCallback((input: SAInput, config?: Partial<SAConfig>): Promise<SAResult> => {
    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setIsRunning(true);
    setProgress(0);
    setError(null);

    return new Promise<SAResult>((resolve, reject) => {
      const worker = new Worker(new URL('../workers/scheduling-worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;

        switch (msg.type) {
          case 'progress':
            setProgress(msg.pct);
            break;
          case 'result':
            setIsRunning(false);
            setProgress(100);
            worker.terminate();
            workerRef.current = null;
            resolve(msg.result);
            break;
          case 'error':
            setIsRunning(false);
            setProgress(null);
            setError(msg.error);
            worker.terminate();
            workerRef.current = null;
            reject(new Error(msg.error));
            break;
        }
      };

      worker.onerror = (err) => {
        setIsRunning(false);
        setProgress(null);
        setError(err.message);
        worker.terminate();
        workerRef.current = null;
        reject(new Error(err.message));
      };

      const request: WorkerRequest = { type: 'run-sa', input, config };
      worker.postMessage(request);
    });
  }, []);

  return { runSA, progress, isRunning, error, cancel };
}
