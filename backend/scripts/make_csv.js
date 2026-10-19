// Generate a deterministic sales CSV for benchmarks: node scripts/make_csv.js <rows> <out.csv>
const fs = require('fs');

const rows = Number(process.argv[2] || 10000);
const out = process.argv[3] || `bench_${rows}.csv`;

// Small seeded PRNG (mulberry32) so every run produces the same file.
let seed = 42;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const regions = ['north', 'south', 'east', 'west', 'central'];
const products = ['widget', 'gadget', 'doohickey', 'gizmo', 'sprocket', 'thingamajig'];

const stream = fs.createWriteStream(out);
stream.write('order_id,order_date,region,product,quantity,unit_price,customer_email,notes\n');
for (let i = 1; i <= rows; i++) {
  const day = new Date(Date.UTC(2024, 0, 1) + Math.floor(rand() * 365) * 86400000);
  const line = [
    i,
    day.toISOString().slice(0, 10),
    pick(regions),
    pick(products),
    1 + Math.floor(rand() * 20),
    (1 + rand() * 99).toFixed(2),
    `customer${Math.floor(rand() * 5000)}@example.com`,
    rand() < 0.7 ? '' : `note ${i}`,
  ];
  stream.write(line.join(',') + '\n');
}
stream.end(() => {
  console.log(`Wrote ${rows} rows to ${out} (${fs.statSync(out).size} bytes)`);
});
