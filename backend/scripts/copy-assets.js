// tsc only emits .js/.ts sources; copy the non-code assets the server reads at runtime.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const assets = ['db/migrations'];

for (const rel of assets) {
  const src = path.join(root, rel);
  const dest = path.join(root, 'dist', rel);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    if (file.endsWith('.sql')) fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}
