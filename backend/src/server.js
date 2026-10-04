const http = require('node:http');
const app = require('./app');
const prisma = require('./config/prisma');
const { port, frontendUrl } = require('./config/env');
const { ensureBucket } = require('./services/minio');
const { createSocketServer } = require('./sockets');

const server = http.createServer(app);
const io = createSocketServer(server, frontendUrl);
Promise.all([io.callService.ready, ensureBucket()]).then(() => server.listen(port, () => console.log(`Gather backend listening on http://localhost:${port}`))).catch((error) => {
  console.error('[startup] mediasoup or MinIO initialization failed; backend will not accept traffic.', error);
  process.exitCode = 1;
  io.callService.close().finally(() => prisma.$disconnect());
});

let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing server.`);
  const force = setTimeout(() => { console.error('Shutdown timed out.'); process.exit(1); }, 10000);
  force.unref();
  try {
    await io.callService.close();
    await new Promise((resolve) => io.close(resolve));
    await prisma.$disconnect();
    process.exit(exitCode);
  } catch (error) {
    console.error('Shutdown cleanup failed.', error);
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => { console.error('Unhandled rejection:', error); shutdown('unhandledRejection', 1); });
process.on('uncaughtException', (error) => { console.error('Uncaught exception:', error); shutdown('uncaughtException', 1); });
