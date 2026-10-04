const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const mediasoup = {
  workerCount: Math.max(1, Math.min(16, Number(process.env.MEDIASOUP_WORKER_COUNT || 1))),
  rtcMinPort: Number(process.env.MEDIASOUP_RTC_MIN_PORT || 40000),
  rtcMaxPort: Number(process.env.MEDIASOUP_RTC_MAX_PORT || 49999),
  listenIp: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1',
  announcedAddress: process.env.MEDIASOUP_ANNOUNCED_ADDRESS || undefined,
  enableUdp: process.env.MEDIASOUP_ENABLE_UDP !== 'false',
  enableTcp: process.env.MEDIASOUP_ENABLE_TCP !== 'false',
  preferUdp: process.env.MEDIASOUP_PREFER_UDP !== 'false',
  callTimeoutMs: Math.max(10000, Number(process.env.CALL_RING_TIMEOUT_MS || 45000)),
  reconnectGraceMs: Math.max(3000, Number(process.env.CALL_RECONNECT_GRACE_MS || 15000))
};

const storage = {
  enabled: process.env.MINIO_ENABLED !== 'false',
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT || process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  accessKey: process.env.MINIO_ACCESS_KEY || 'gatheradmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'gather_dev_storage_password',
  bucket: process.env.MINIO_BUCKET || 'gather-media',
  region: process.env.MINIO_REGION || 'us-east-1',
  presignExpiresSeconds: Math.min(3600, Math.max(60, Number(process.env.MINIO_PRESIGN_EXPIRES_SECONDS || 300))),
  startupRetries: Math.min(20, Math.max(1, Number(process.env.MINIO_STARTUP_RETRIES || 15))),
  startupRetryDelayMs: Math.min(10000, Math.max(250, Number(process.env.MINIO_STARTUP_RETRY_DELAY_MS || 1000)))
};
if (!storage.endpoint.startsWith('http://') && !storage.endpoint.startsWith('https://')) throw new Error('MINIO_ENDPOINT must be an http(s) URL.');

if (!Number.isInteger(mediasoup.rtcMinPort) || !Number.isInteger(mediasoup.rtcMaxPort) || mediasoup.rtcMinPort < 1024 || mediasoup.rtcMaxPort <= mediasoup.rtcMinPort) {
  throw new Error('MEDIASOUP_RTC_MIN_PORT and MEDIASOUP_RTC_MAX_PORT must define a valid inclusive port range.');
}
if (!mediasoup.enableUdp && !mediasoup.enableTcp) throw new Error('At least one of MEDIASOUP_ENABLE_UDP or MEDIASOUP_ENABLE_TCP must be enabled.');

module.exports = {
  port: Number(process.env.BACKEND_PORT || 4000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  authSecret: process.env.AUTH_SECRET,
  internalAuthSecret: process.env.INTERNAL_AUTH_SECRET,
  uploadDir: path.resolve(__dirname, '../../../', process.env.UPLOAD_DIR || 'uploads'),
  nodeEnv: process.env.NODE_ENV || 'development',
  mediasoup,
  storage
};
