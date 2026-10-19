// tsc only emits .js/.ts sources; copy the non-code assets the server reads at runtime.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const assets = [
  { dir: 'db/migrations', ext: ['.sql'] },
  { dir: 'eval/data', ext: ['.csv'] },
  { dir: 'eval', ext: ['.jsonl'] },
];

for (const { dir, ext } of assets) {
  const src = path.join(root, dir);
  const dest = path.join(root, 'dist', dir);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    if (ext.includes(path.extname(file)))
      fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}
