let failures = 0;
let circuitOpenUntil = 0;
const FAILURE_THRESHOLD = 3;
const CIRCUIT_MS = 15_000;

async function recommend(payload) {
  const baseUrl = process.env.REELS_RECOMMENDER_URL;
  const token = process.env.REELS_RECOMMENDER_TOKEN;
  const schemaFingerprint = process.env.REELS_RECOMMENDER_SCHEMA_FINGERPRINT;
  if (!baseUrl || !token || !schemaFingerprint || Date.now() < circuitOpenUntil) return null;
  const timeoutMs = Math.min(5000, Math.max(250, Number(process.env.REELS_RECOMMENDER_TIMEOUT_MS) || 1200));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/recommendations`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, featureSchemaFingerprint: schemaFingerprint }), signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (body.status === 'COLD_START' || response.status === 503) return null;
      throw new Error(`service returned ${response.status}`);
    }
    const result = await response.json();
    if (result.featureSchemaVersion !== 'gather-reco-v1' || result.featureSchemaFingerprint !== schemaFingerprint) throw new Error('service feature schema mismatch');
    failures = 0;
    return result;
  } catch (error) {
    failures += 1;
    if (failures >= FAILURE_THRESHOLD) circuitOpenUntil = Date.now() + CIRCUIT_MS;
    console.warn(`[reco] model service unavailable; fallback active (${error.name === 'AbortError' ? 'timeout' : 'request error'})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { recommend };
