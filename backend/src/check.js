const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sourceRoot = __dirname;
const files = [];
function collect(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) collect(absolute);
    else if (item.isFile() && item.name.endsWith('.js') && item.name !== 'check.js') files.push(absolute);
  }
}
collect(sourceRoot);
files.push(path.resolve(__dirname, '../../prisma/seed.js'));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`JavaScript syntax checks passed (${files.length} files).`);
