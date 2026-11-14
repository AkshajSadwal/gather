let failures = 0;
let circuitOpenUntil = 0;
const FAILURE_THRESHOLD = 3;
const CIRCUIT_MS = 15_000;
const MODEL_MODE = 'kuairand_zero_shot_v1';

function isConfigured() {
  return process.env.REELS_RECOMMENDER_ENABLED !== 'false' && Boolean(
    process.env.REELS_RECOMMENDER_URL && process.env.REELS_RECOMMENDER_TOKEN && process.env.REELS_RECOMMENDER_SCHEMA_FINGERPRINT
  );
}

function logFallback(reason, httpStatus) {
  console.warn(JSON.stringify({ component: 'recommender', event: 'model_fallback', reason, ...(httpStatus ? { httpStatus } : {}) }));
}

async function recommend(payload, onStatus = () => {}) {
  const baseUrl = process.env.REELS_RECOMMENDER_URL;
  const token = process.env.REELS_RECOMMENDER_TOKEN;
  const schemaFingerprint = process.env.REELS_RECOMMENDER_SCHEMA_FINGERPRINT;
  if (!isConfigured()) { onStatus('model_disabled'); return null; }
  if (Date.now() < circuitOpenUntil) { onStatus('model_unavailable'); return null; }
  const timeoutMs = Math.min(5000, Math.max(250, Number(process.env.REELS_RECOMMENDER_TIMEOUT_MS) || 1200));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reason = 'request_error';
  let httpStatus;
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/recommendations`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, featureSchemaFingerprint: schemaFingerprint }), signal: controller.signal
    });
    if (!response.ok) {
      httpStatus = response.status;
      const body = await response.json().catch(() => ({}));
      reason = body?.status === 'COLD_START' || body?.detail?.status === 'COLD_START' ? 'model_cold_start' : 'http_error';
      throw new Error('Model did not rank the request');
    }
    reason = 'invalid_response';
    const result = await response.json();
    if (result?.status === 'COLD_START') { reason = 'model_cold_start'; throw new Error('Model is warming up'); }
    if (result?.mode !== MODEL_MODE || result?.trainingDomain !== 'KuaiRand-1K') { reason = 'mode_mismatch'; throw new Error('Model mode mismatch'); }
    if (result.featureSchemaVersion !== 'gather-reco-v1' || result.featureSchemaFingerprint !== schemaFingerprint) { reason = 'schema_mismatch'; throw new Error('Model schema mismatch'); }
    if (result.status !== 'READY' || !Array.isArray(result.items)) throw new Error('Model did not return a ranked list');
    failures = 0;
    return result;
  } catch (error) {
    failures += 1;
    if (failures >= FAILURE_THRESHOLD) circuitOpenUntil = Date.now() + CIRCUIT_MS;
    if (error.name === 'AbortError') reason = 'timeout';
    onStatus(reason === 'model_cold_start' ? reason : ['mode_mismatch', 'schema_mismatch', 'invalid_response'].includes(reason) ? 'model_incompatible' : 'model_unavailable');
    logFallback(reason, httpStatus);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { recommend, isConfigured, logFallback };
