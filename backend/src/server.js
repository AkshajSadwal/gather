const http = require('node:http');
const app = require('./app');
const prisma = require('./config/prisma');
const { port, frontendUrl } = require('./config/env');
const { createSocketServer } = require('./sockets');

const server = http.createServer(app);
createSocketServer(server, frontendUrl);
server.listen(port, () => console.log(`Social backend listening on http://localhost:${port}`));

let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing server.`);
  const force = setTimeout(() => { console.error('Shutdown timed out.'); process.exit(1); }, 10000);
  force.unref();
  server.close(async () => {
    try { await prisma.$disconnect(); process.exit(exitCode); }
    catch { process.exit(1); }
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => { console.error('Unhandled rejection:', error); shutdown('unhandledRejection', 1); });
process.on('uncaughtException', (error) => { console.error('Uncaught exception:', error); shutdown('uncaughtException', 1); });
