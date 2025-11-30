import { Worker } from 'node:worker_threads';
import path from 'node:path';

export class WorkerPool {
  running = 0;
  queue = [];
  constructor(max) { this.max = max; }

  async run(payload) {
    if (this.running >= this.max) {
      return new Promise((resolve, reject) => this.queue.push({ payload, resolve, reject }));
    }
    return this.spawn(payload);
  }

  drain() {
    if (this.running >= this.max) return;
    const next = this.queue.shift();
    if (!next) return;
    this.spawn(next.payload).then(next.resolve).catch(next.reject);
  }

  spawn(payload) {
    this.running++;
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.resolve('src/worker.js'));
      const cleanup = () => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const onMessage = (msg) => {
        cleanup();
        this.running--; this.drain();
        if (msg?.ok) resolve(msg.result); else reject(msg?.result || msg);
      };
      const onError = (err) => { cleanup(); this.running--; this.drain(); reject(err); };
      const onExit = (code) => { if (code !== 0) onError(new Error(`worker exit ${code}`)); };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      worker.postMessage(payload);
    });
  }
}
