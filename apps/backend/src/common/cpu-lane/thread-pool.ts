import { Worker } from 'node:worker_threads';

/**
 * A fixed pool of worker threads running one script — the CPU lane's engine
 * (S6, `docs/plans/propositions-phase-b.md`). Work that would block the event
 * loop (PDF parsing, rasterisation, OCR preprocessing) runs in a thread, so
 * the main thread keeps renewing every job lock.
 *
 * Protocol: the script posts `{ ready: true }` once loaded, then answers
 * each `{ id, payload }` message with `{ id, ok: true, result }` or
 * `{ id, ok: false, error }`. Transferable buffers move, not copy. A task
 * that exceeds `timeoutMs` has its thread terminated and replaced — a stuck
 * parse costs one thread, not the worker process.
 *
 * `maxOldGenerationMb` caps each thread's JS heap, and ONLY that: mupdf's
 * WebAssembly memory, sharp's native buffers and tesseract's own worker sit
 * outside it, so a runaway rasterise can still grow the process's RSS and
 * meet the container limit, which takes every in-flight job with it. Size
 * the pool from measured RSS (1.9 GiB at two threads, UAT 2026-10-25), not
 * from this cap.
 *
 * A script that cannot load (missing from the build, a throw at import)
 * dies before saying ready; after {@link MAX_UNREADY_DEATHS} such deaths in
 * a row the pool stops respawning — instead of spinning forever — and fails
 * every task with the reason, then tries again after {@link BROKEN_COOLDOWN_MS}
 * (a spawn can also fail transiently, under memory or file-handle pressure).
 * A thread that dies AFTER ready (a hostile PDF) is replaced as usual.
 *
 * Deliberately threads, not child processes: no Prisma engine or DB
 * connections per slot. If native crashes ever appear (a segfault in a
 * thread takes the process down), this is the one seam to swap for
 * processes — callers only see `run()`.
 */
export interface ThreadPoolOptions {
  /** Absolute path of the compiled thread script (.js). */
  file: string;
  size: number;
  timeoutMs: number;
  maxOldGenerationMb: number;
}

interface Task<Req, Res> {
  id: number;
  payload: Req;
  transfer: ArrayBuffer[];
  resolve: (result: Res) => void;
  reject: (error: Error) => void;
}

interface Slot<Req, Res> {
  worker: Worker;
  task?: Task<Req, Res>;
  timer?: NodeJS.Timeout;
  ready: boolean;
}

/** Consecutive deaths before ready that mark the script as unloadable. */
const MAX_UNREADY_DEATHS = 3;

/** How long a broken pool fails fast before trying to spawn again. */
const BROKEN_COOLDOWN_MS = 5 * 60 * 1000;

/** Thread errors return to callers and logs; keep them short. */
const MAX_ERROR_CHARS = 200;

function shorten(message: string): string {
  return message.length > MAX_ERROR_CHARS
    ? `${message.slice(0, MAX_ERROR_CHARS)}…`
    : message;
}

export class ThreadPool<Req, Res> {
  private readonly slots: Slot<Req, Res>[] = [];
  private readonly waiting: Task<Req, Res>[] = [];
  private nextId = 0;
  private closed = false;
  private unreadyDeaths = 0;
  /** Set once the script is known not to load; every task then fails. */
  private broken?: { reason: string; at: number };

  constructor(private readonly options: ThreadPoolOptions) {
    if (!Number.isInteger(options.size) || options.size < 1) {
      throw new Error(
        `ThreadPool size must be a positive integer, got ${options.size}`,
      );
    }
    for (let i = 0; i < options.size; i++) this.slots.push(this.spawn());
  }

  get size(): number {
    return this.slots.length;
  }

  run(payload: Req, transfer: ArrayBuffer[] = []): Promise<Res> {
    if (this.closed) return Promise.reject(new Error('ThreadPool is closed'));
    if (this.broken) {
      if (Date.now() - this.broken.at < BROKEN_COOLDOWN_MS) {
        return Promise.reject(new Error(this.broken.reason));
      }
      this.revive();
    }
    return new Promise<Res>((resolve, reject) => {
      this.waiting.push({
        id: this.nextId++,
        payload,
        transfer,
        resolve,
        reject,
      });
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const task of this.waiting.splice(0)) {
      task.reject(new Error('ThreadPool closed before the task ran'));
    }
    await Promise.all(this.slots.map((slot) => this.retire(slot, 'closed')));
  }

  private spawn(): Slot<Req, Res> {
    const worker = new Worker(this.options.file, {
      resourceLimits: {
        maxOldGenerationSizeMb: this.options.maxOldGenerationMb,
      },
    });
    const slot: Slot<Req, Res> = { worker, ready: false };
    worker.on(
      'message',
      (msg: {
        ready?: boolean;
        id: number;
        ok: boolean;
        result?: Res;
        error?: string;
      }) => {
        if (msg.ready) {
          slot.ready = true;
          this.unreadyDeaths = 0;
          return;
        }
        const task = slot.task;
        if (!task || task.id !== msg.id) return;
        this.finish(slot);
        if (msg.ok) task.resolve(msg.result as Res);
        else task.reject(new Error(shorten(msg.error ?? 'thread task failed')));
        this.dispatch();
      },
    );
    // A thread that dies (an error it did not catch, its heap cap, a
    // terminate) fails its task and is replaced, so the pool keeps its size.
    worker.on('exit', (code) =>
      this.replace(slot, `thread exited (code ${code})`),
    );
    worker.on('error', (error: Error) => this.replace(slot, error.message));
    return slot;
  }

  private dispatch(): void {
    for (const slot of this.slots) {
      if (slot.task || this.waiting.length === 0) continue;
      const task = this.waiting.shift()!;
      slot.task = task;
      slot.timer = setTimeout(
        () =>
          void this.replace(
            slot,
            `no result within ${this.options.timeoutMs}ms`,
            true,
          ),
        this.options.timeoutMs,
      );
      slot.worker.postMessage(
        { id: task.id, payload: task.payload },
        task.transfer,
      );
    }
  }

  private finish(slot: Slot<Req, Res>): void {
    clearTimeout(slot.timer);
    slot.timer = undefined;
    slot.task = undefined;
  }

  /** Fail the slot's task, retire its thread, and put a fresh one in its place. */
  private async replace(
    slot: Slot<Req, Res>,
    reason: string,
    terminate = false,
  ): Promise<void> {
    const index = this.slots.indexOf(slot);
    if (index === -1) return;
    const task = slot.task;
    this.finish(slot);
    this.slots.splice(index, 1);
    task?.reject(new Error(shorten(reason)));
    if (terminate) await slot.worker.terminate();
    if (this.closed) return;
    if (!slot.ready && ++this.unreadyDeaths >= MAX_UNREADY_DEATHS) {
      this.breakPool(reason);
      return;
    }
    this.slots.splice(index, 0, this.spawn());
    this.dispatch();
  }

  /** The script does not load: stop respawning and fail everything, loudly. */
  private breakPool(reason: string): void {
    this.broken = {
      reason:
        `thread script ${this.options.file} failed to start ` +
        `${this.unreadyDeaths} times in a row (${shorten(reason)})`,
      at: Date.now(),
    };
    for (const task of this.waiting.splice(0)) {
      task.reject(new Error(this.broken.reason));
    }
  }

  /** After the cooldown: refill the pool and try the script again. */
  private revive(): void {
    this.broken = undefined;
    this.unreadyDeaths = 0;
    while (this.slots.length < this.options.size) this.slots.push(this.spawn());
  }

  private async retire(slot: Slot<Req, Res>, reason: string): Promise<void> {
    slot.worker.removeAllListeners('exit');
    slot.worker.removeAllListeners('error');
    const task = slot.task;
    this.finish(slot);
    task?.reject(new Error(reason));
    await slot.worker.terminate();
  }
}
