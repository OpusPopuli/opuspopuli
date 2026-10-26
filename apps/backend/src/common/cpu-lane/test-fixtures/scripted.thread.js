// A thread for ThreadPool's spec: echoes, sleeps, throws or dies on command.
// Plain CommonJS, because a worker thread loads it by path.
/* global require, process, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { parentPort } = require('node:worker_threads');

parentPort.postMessage({ ready: true });

parentPort.on('message', async ({ id, payload }) => {
  const startedAt = Date.now();
  const { op, ms, value, bytes } = payload;
  if (op === 'throw-long') {
    parentPort.postMessage({ id, ok: false, error: 'x'.repeat(5000) });
    return;
  }
  if (op === 'exit') process.exit(3);
  if (op === 'hang') return; // never answers — the pool's timeout must act
  if (ms) await new Promise((r) => setTimeout(r, ms));
  if (op === 'throw') {
    parentPort.postMessage({ id, ok: false, error: 'scripted failure' });
    return;
  }
  parentPort.postMessage({
    id,
    ok: true,
    result: {
      value,
      length: bytes ? bytes.byteLength : undefined,
      startedAt,
    },
  });
});
