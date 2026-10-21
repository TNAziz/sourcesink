/**
 * SourceSink — Web Worker entry for the Analyze panel.
 *
 * The worker only marshals messages: the analysis itself lives in
 * `workerCore.handle`, which is also unit-tested directly. Posting progress
 * before the blocking computation lets the UI show a stage label while the
 * simulation runs.
 */

import { handle, progressStage } from "./workerCore.js";
import type { StatusResponse, WorkerRequest, WorkerResponse } from "./workerCore.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  const progress: StatusResponse = {
    id: request.id,
    type: "progress",
    stage: progressStage(request.kind),
  };
  scope.postMessage(progress);
  scope.postMessage(handle(request));
};
