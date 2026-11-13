const signatures = [
  { type: 'image/jpeg', matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: 'image/png', matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/webp', matches: (bytes) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' },
  { type: 'image/gif', matches: (bytes) => ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) },
  { type: 'video/webm', matches: (bytes) => bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { type: 'video/mp4', matches: (bytes) => bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' && !bytes.toString('ascii', 8, 12).startsWith('qt  ') },
  { type: 'video/quicktime', matches: (bytes) => bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.toString('ascii', 8, 12).startsWith('qt  ') }
];

function detectMediaType(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  return signatures.find((signature) => signature.matches(bytes))?.type || null;
}

function matchesDeclaredMediaType(bytes, declaredType) {
  return detectMediaType(bytes) === declaredType;
}

module.exports = { detectMediaType, matchesDeclaredMediaType };
