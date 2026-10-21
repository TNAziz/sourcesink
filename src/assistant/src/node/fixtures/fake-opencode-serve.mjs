#!/usr/bin/env node
// Fake `opencode serve` for the bridge tests. It implements just enough of the
// HTTP API (Basic auth, sessions, messages, SSE deltas, abort, delete) and
// never touches the network beyond 127.0.0.1. All observations go to the file
// named by FAKE_SERVE_LOG, one event per line, so tests can assert on them.
import { readFileSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_SERVE_LOG;
const password = process.env.OPENCODE_SERVER_PASSWORD;
const crashMarker = process.env.FAKE_SERVE_CRASH_MARKER;

function log(line) {
  if (!logPath) return;
  appendFileSync(logPath, `${line}\n`);
}

function fail(message, code = 4) {
  log(`fail ${message}`);
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

if (args[0] !== "serve") fail("fake serve expects the serve subcommand");
if (!password) fail("OPENCODE_SERVER_PASSWORD was not set");
const configPath = process.env.OPENCODE_CONFIG;
if (!configPath) fail("OPENCODE_CONFIG was not set");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  fail("OPENCODE_CONFIG is not readable JSON");
}
if (config?.agent?.sourcesink?.tools?.["*"] !== false) {
  fail('agent.sourcesink.tools["*"] is not false');
}

const host = argValue("--hostname", "127.0.0.1");
const port = Number(argValue("--port", "4096"));
const expectedAuth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
const events = new Set();
let sessionCounter = 0;
let messageCounter = 0;

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function unauthorized(res) {
  sendJson(res, 401, { error: "unauthorized" });
}

function sendEvent(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of events) client.write(frame);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

function authOk(req) {
  return req.headers.authorization === expectedAuth;
}

const REPLY = "Hello from the fake server";
const DELTAS = ["Hello ", "from the ", "fake server"];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}`);
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (!authOk(req)) {
    log(`unauthorized ${method} ${pathname}`);
    unauthorized(res);
    return;
  }

  if (method === "GET" && pathname === "/event") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
    events.add(res);
    req.on("close", () => events.delete(res));
    return;
  }

  if (method === "POST" && pathname === "/session") {
    sessionCounter += 1;
    const id = `ses_test_${sessionCounter}`;
    log(`session ${id}`);
    sendJson(res, 200, { id, title: "sourcesink" });
    return;
  }

  const messageMatch = pathname.match(/^\/session\/([^/]+)\/message$/);
  if (method === "POST" && messageMatch) {
    const sessionID = decodeURIComponent(messageMatch[1]);
    void readBody(req).then((raw) => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "bad json" });
        return;
      }
      const prompt = Array.isArray(body.parts)
        ? body.parts
            .filter((part) => part && part.type === "text" && typeof part.text === "string")
            .map((part) => part.text)
            .join("")
        : "";
      log(`message ${sessionID} ${body.agent ?? "?"}`);
      if (body.agent !== "sourcesink") {
        sendJson(res, 400, { error: "unexpected agent" });
        return;
      }
      if (body.model?.providerID !== "openrouter" || typeof body.model?.modelID !== "string") {
        sendJson(res, 400, { error: "unexpected model" });
        return;
      }

      if (prompt.includes("CRASH_EVERY")) {
        log(`crash ${sessionID}`);
        process.exit(1);
      }
      if (prompt.includes("CRASH_ONCE")) {
        if (crashMarker && existsSync(crashMarker)) {
          log(`crash-skipped ${sessionID}`);
        } else {
          if (crashMarker) writeFileSync(crashMarker, "crashed");
          log(`crash ${sessionID}`);
          process.exit(1);
        }
      }

      messageCounter += 1;
      const messageID = `msg_${messageCounter}`;
      const partID = `prt_${messageCounter}`;
      const reasoningID = `prt_${messageCounter}_reasoning`;
      let cancelled = false;
      res.on("close", () => {
        cancelled = true;
      });

      // A decoy delta for another session and a reasoning part: the bridge must
      // stream only the visible text part of this session.
      sendEvent({
        type: "message.part.delta",
        properties: {
          sessionID: "ses_other",
          messageID,
          partID,
          field: "text",
          delta: "WRONG ",
        },
      });
      sendEvent({
        type: "message.part.updated",
        properties: {
          sessionID,
          part: { type: "reasoning", id: reasoningID, messageID, sessionID },
          time: Date.now(),
        },
      });
      sendEvent({
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID,
          partID: reasoningID,
          field: "text",
          delta: "REASONING ",
        },
      });
      sendEvent({
        type: "message.part.updated",
        properties: {
          sessionID,
          part: { type: "text", id: partID, messageID, sessionID, text: "" },
          time: Date.now(),
        },
      });

      const slow = prompt.includes("SLOW");
      const delay = slow ? 5000 : 25;

      let index = 0;
      const step = () => {
        if (cancelled) return;
        if (index < DELTAS.length) {
          const delta = DELTAS[index];
          index += 1;
          sendEvent({
            type: "message.part.delta",
            properties: { sessionID, messageID, partID, field: "text", delta },
          });
          setTimeout(step, delay);
          return;
        }
        sendEvent({
          type: "message.part.updated",
          properties: {
            sessionID,
            part: { type: "text", id: partID, messageID, sessionID, text: REPLY },
            time: Date.now(),
          },
        });
        sendEvent({ type: "session.idle", properties: { sessionID } });
        log(`done ${sessionID}`);
        sendJson(res, 200, {
          info: {
            id: messageID,
            role: "assistant",
            sessionID,
            agent: "sourcesink",
            cost: 0.001,
            tokens: { total: 12, input: 10, output: 2 },
          },
          parts: [
            { type: "step-start", id: "prt_start", messageID, sessionID },
            { type: "text", id: partID, messageID, sessionID, text: REPLY },
            {
              type: "step-finish",
              id: "prt_finish",
              messageID,
              sessionID,
              reason: "stop",
              cost: 0.001,
              tokens: { total: 12, input: 10, output: 2 },
            },
          ],
        });
      };
      setTimeout(step, delay);
    });
    return;
  }

  const abortMatch = pathname.match(/^\/session\/([^/]+)\/abort$/);
  if (method === "POST" && abortMatch) {
    log(`abort ${decodeURIComponent(abortMatch[1])}`);
    sendJson(res, 200, {});
    return;
  }

  const deleteMatch = pathname.match(/^\/session\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    log(`delete ${decodeURIComponent(deleteMatch[1])}`);
    sendJson(res, 200, {});
    return;
  }

  log(`missing ${method} ${pathname}`);
  sendJson(res, 404, { error: "not found" });
});

server.listen(port, host, () => {
  const address = server.address();
  const actual = typeof address === "object" && address !== null ? address.port : port;
  log(`spawn ${actual}`);
  process.stdout.write(`opencode server listening on http://${host}:${actual}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log(`signal ${signal}`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 200).unref();
  });
}
