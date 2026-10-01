const { EventEmitter } = require('node:events');
const os = require('node:os');
const mediasoup = require('mediasoup');

class MediaWorkerPool extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.workers = [];
    this.cursor = 0;
    this.closed = false;
    this.startPromise = null;
  }

  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = Promise.all(Array.from({ length: this.config.workerCount }, () => this.createWorker()));
    return this.startPromise;
  }

  async createWorker() {
    if (this.closed) return null;
    const worker = await mediasoup.createWorker({
      logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'error',
      rtcMinPort: this.config.rtcMinPort,
      rtcMaxPort: this.config.rtcMaxPort
    });
    worker.on('died', (error) => {
      this.workers = this.workers.filter((item) => item !== worker);
      this.emit('worker:died', { worker, error });
      if (!this.closed) {
        console.error('[mediasoup] Worker died; active rooms on it will fail and a replacement will be started.', error);
        setTimeout(() => this.createWorker().catch((replacementError) => {
          console.error('[mediasoup] Could not replace the dead worker.', replacementError);
          this.emit('worker:replacement-failed', replacementError);
        }), 1000).unref();
      }
    });
    this.workers.push(worker);
    console.info(`[mediasoup] Worker ${worker.pid} ready (RTC ports ${this.config.rtcMinPort}-${this.config.rtcMaxPort}).`);
    return worker;
  }

  nextWorker() {
    const available = this.workers.filter((worker) => !worker.closed);
    if (!available.length) throw new Error('MEDIA_SERVER_UNAVAILABLE');
    const worker = available[this.cursor % available.length];
    this.cursor = (this.cursor + 1) % available.length;
    return worker;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const workers = this.workers.splice(0);
    await Promise.allSettled(workers.map((worker) => worker.close()));
  }
}

module.exports = { MediaWorkerPool, recommendedWorkerCount: Math.max(1, os.cpus().length - 1) };
