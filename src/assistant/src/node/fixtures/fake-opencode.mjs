#!/usr/bin/env node
// Fake `opencode` for the bridge tests. It is deliberately dependency-free and
// never talks to a network. Behaviour is chosen with FAKE_OPENCODE_MODE.
import { readFileSync, readdirSync } from "node:fs";

const mode = process.env.FAKE_OPENCODE_MODE ?? "success";
const args = process.argv.slice(2);

function fail(message, code = 4) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

if (args[0] === "models") {
  if (mode === "models-fail") fail("not signed in", 2);
  process.stdout.write("openrouter/zeta\nopenrouter/alpha\n\nopenrouter/alpha\n");
  process.exit(0);
}

if (args[0] === "--version") {
  if (mode === "version-fail") fail("version exploded", 3);
  process.stdout.write("1.2.3\n");
  process.exit(0);
}

if (mode === "sleep") {
  setInterval(() => {}, 1000);
} else if (mode === "exit") {
  process.stderr.write("first diagnostic line\nopencode: not authenticated\n");
  process.exit(7);
} else if (mode === "error-event") {
  process.stdout.write('{"type":"error","error":{"message":"model refused"}}\n');
  process.exit(0);
} else if (mode === "no-text") {
  process.stdout.write('{"type":"step_finish","part":{"reason":"stop"}}\n');
  process.exit(0);
} else if (mode === "junk") {
  process.stdout.write("this is not json\n\n");
  process.exit(0);
} else {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    if (!input.includes("### USER")) fail("prompt was not delivered on stdin");

    const configPath = process.env.OPENCODE_CONFIG;
    if (!configPath) fail("OPENCODE_CONFIG was not set");
    let config;
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      fail("OPENCODE_CONFIG is not a readable JSON file");
    }
    if (config?.agent?.sourcesink?.tools?.["*"] !== false) {
      fail('agent.sourcesink.tools["*"] is not false');
    }

    try {
      if (readdirSync(process.cwd()).length !== 0) fail("cwd was not empty");
    } catch {
      fail("cwd is not a readable directory");
    }

    process.stdout.write('{"type":"step_start","part":{"type":"step_start"}}\n');
    process.stdout.write('{"type":"text","part":{"type":"text","text":"hello "}}\n');
    process.stdout.write(`{"type":"text","part":{"type":"text","text":"world ${process.cwd()}"}}\n`);
    process.stdout.write(
      '{"type":"step_finish","part":{"reason":"stop","tokens":{"total":42},"cost":0.0005}}\n',
    );
    process.exit(0);
  });
}
