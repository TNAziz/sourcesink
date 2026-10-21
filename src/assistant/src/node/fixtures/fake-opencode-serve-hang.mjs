#!/usr/bin/env node
// Fake `opencode serve` that never prints its listening line: used to test the
// bridge's start timeout and CLI fallback. It stays alive until killed, so the
// timeout, not a crash, is what the bridge sees.
import { appendFileSync } from "node:fs";

const logPath = process.env.FAKE_SERVE_LOG;
if (logPath) appendFileSync(logPath, "hang spawn\n");
setInterval(() => {}, 1000);
