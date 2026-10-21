/**
 * SourceSink — lifecycle for one analysis Web Worker.
 *
 * A run creates a fresh module worker, posts one request and terminates the
 * worker as soon as a result or error arrives. Cancelling terminates it too,
 * so the UI recovers immediately. The worker is also terminated on unmount.
 */

import { useEffect, useRef, useState } from "react";

import type { StatusResponse, WorkerRequest, WorkerResponse } from "./workerCore.js";

export type ResultResponse = Extract<WorkerResponse, { type: "result" }>;

export interface AnalyzeWorker {
  running: boolean;
  stage: string | null;
  error: string | null;
  run(request: (id: number) => WorkerRequest, onResult: (response: ResultResponse) => void): void;
  cancel(): void;
}

export function useAnalyzeWorker(): AnalyzeWorker {
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = (): void => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setStage(null);
  };

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const cancel = (): void => {
    stop();
    setError(null);
  };

  const run = (
    request: (id: number) => WorkerRequest,
    onResult: (response: ResultResponse) => void,
  ): void => {
    stop();
    setError(null);
    setRunning(true);
    setStage("Starting…");

    idRef.current += 1;
    const payload = request(idRef.current);
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.id !== payload.id) return;
      if (message.type === "progress") {
        setStage((message as StatusResponse).stage);
        return;
      }
      if (message.type === "error") {
        setError(message.error);
        stop();
        return;
      }
      onResult(message);
      stop();
    };

    worker.onerror = (event) => {
      setError(event.message || "The analysis worker failed.");
      stop();
    };

    worker.postMessage(payload);
  };

  return { running, stage, error, run, cancel };
}
