// Generates src/blueNoise.ts: a tileable 64x64 blue noise threshold map built
// with Ulichney's void-and-cluster method. Deterministic for a given seed.
// Run with: node scripts/generate-blue-noise.mjs
import { writeFileSync } from "node:fs";

const SIZE = 64;
const PIXELS = SIZE * SIZE;
const SIGMA = 1.5;
const INITIAL_DENSITY = 0.1;
const SEED = 0x6b617761;

// mulberry32
let state = SEED;
const random = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Toroidal Gaussian, indexed by wrapped (dx, dy)
const kernel = new Float64Array(PIXELS);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = Math.min(x, SIZE - x);
    const dy = Math.min(y, SIZE - y);
    kernel[y * SIZE + x] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
  }
}

const splat = (energy, index, sign) => {
  const px = index % SIZE;
  const py = (index - px) / SIZE;
  for (let y = 0; y < SIZE; y++) {
    const ky = ((y - py + SIZE) % SIZE) * SIZE;
    for (let x = 0; x < SIZE; x++) {
      energy[y * SIZE + x] += sign * kernel[ky + ((x - px + SIZE) % SIZE)];
    }
  }
};

const energyOf = (pattern, value) => {
  const energy = new Float64Array(PIXELS);
  for (let i = 0; i < PIXELS; i++)
    if (pattern[i] === value) splat(energy, i, 1);
  return energy;
};

// Tightest cluster: the set pixel with the most energy. Largest void: the
// unset pixel with the least.
const tightestCluster = (pattern, energy, value) => {
  let best = -1;
  for (let i = 0; i < PIXELS; i++) {
    if (pattern[i] === value && (best < 0 || energy[i] > energy[best]))
      best = i;
  }
  return best;
};
const largestVoid = (pattern, energy, value) => {
  let best = -1;
  for (let i = 0; i < PIXELS; i++) {
    if (pattern[i] !== value && (best < 0 || energy[i] < energy[best]))
      best = i;
  }
  return best;
};

// Initial binary pattern: random minority pixels, relaxed until the tightest
// cluster is also the largest void
const initial = new Uint8Array(PIXELS);
let ones = 0;
while (ones < Math.round(PIXELS * INITIAL_DENSITY)) {
  const i = Math.floor(random() * PIXELS);
  if (!initial[i]) {
    initial[i] = 1;
    ones++;
  }
}
{
  const energy = energyOf(initial, 1);
  for (;;) {
    const cluster = tightestCluster(initial, energy, 1);
    initial[cluster] = 0;
    splat(energy, cluster, -1);
    const gap = largestVoid(initial, energy, 1);
    if (gap === cluster) {
      initial[cluster] = 1;
      break;
    }
    initial[gap] = 1;
    splat(energy, gap, 1);
  }
}

const rank = new Uint32Array(PIXELS);

// Phase 1: remove the tightest clusters, ranking down from the initial count
{
  const pattern = initial.slice();
  const energy = energyOf(pattern, 1);
  for (let r = ones - 1; r >= 0; r--) {
    const cluster = tightestCluster(pattern, energy, 1);
    pattern[cluster] = 0;
    splat(energy, cluster, -1);
    rank[cluster] = r;
  }
}

// Phase 2: fill the largest voids up to half
const pattern = initial.slice();
{
  const energy = energyOf(pattern, 1);
  for (let r = ones; r < PIXELS / 2; r++) {
    const gap = largestVoid(pattern, energy, 1);
    pattern[gap] = 1;
    splat(energy, gap, 1);
    rank[gap] = r;
  }
}

// Phase 3: zeros are now the minority; fill their tightest clusters
{
  const energy = energyOf(pattern, 0);
  for (let r = PIXELS / 2; r < PIXELS; r++) {
    const cluster = tightestCluster(pattern, energy, 0);
    pattern[cluster] = 1;
    splat(energy, cluster, -1);
    rank[cluster] = r;
  }
}

const bytes = Uint8Array.from(rank, (r) => Math.floor((r * 256) / PIXELS));
const base64 = Buffer.from(bytes).toString("base64");
const lines = base64.match(/.{1,76}/g) ?? [];

// Green and blue read the tile at shifted positions. Pick the pair of shifts
// whose triangular-remapped noise is least correlated with red and with each
// other, so the three channels dither independently.
const triangular = (u) => {
  const v = u * 2 - 1;
  return Math.sign(v) * (1 - Math.sqrt(1 - Math.abs(v)));
};
const shaped = Float64Array.from(bytes, (b) => triangular((b + 0.5) / 256));
let power = 0;
for (const v of shaped) power += v * v;
const correlation = new Float64Array(PIXELS);
for (let dy = 0; dy < SIZE; dy++) {
  for (let dx = 0; dx < SIZE; dx++) {
    let sum = 0;
    for (let y = 0; y < SIZE; y++) {
      const row = ((y + dy) % SIZE) * SIZE;
      for (let x = 0; x < SIZE; x++) {
        sum += shaped[y * SIZE + x] * shaped[row + ((x + dx) % SIZE)];
      }
    }
    correlation[dy * SIZE + dx] = Math.abs(sum / power);
  }
}
const shiftCorrelation = (dx, dy) =>
  correlation[
    (((dy % SIZE) + SIZE) % SIZE) * SIZE + (((dx % SIZE) + SIZE) % SIZE)
  ];
const candidates = [];
for (let i = 1; i < PIXELS; i++) {
  if (correlation[i] < 0.02) candidates.push([i % SIZE, Math.floor(i / SIZE)]);
}
let channelOffsets = [0, 0, 0, 0, 0, 0];
let worst = Number.POSITIVE_INFINITY;
for (const [gx, gy] of candidates) {
  for (const [bx, by] of candidates) {
    const score = Math.max(
      shiftCorrelation(gx, gy),
      shiftCorrelation(bx, by),
      shiftCorrelation(bx - gx, by - gy),
    );
    if (score < worst) {
      worst = score;
      channelOffsets = [0, 0, gx, gy, bx, by];
    }
  }
}

writeFileSync(
  new URL("../src/blueNoise.ts", import.meta.url),
  `// Generated by scripts/generate-blue-noise.mjs. Do not edit.
// ${SIZE}x${SIZE} void-and-cluster blue noise, one byte per texel, uniformly
// distributed over 0-255 and tileable.

export const BLUE_NOISE_SIZE = ${SIZE};

// Texel shifts for the red, green, and blue lookups (worst correlation ${worst.toFixed(4)})
export const BLUE_NOISE_CHANNEL_OFFSETS = [${channelOffsets.join(", ")}];

const BLUE_NOISE_BASE64 =
${lines.map((line, i) => `  "${line}"${i === lines.length - 1 ? ";" : " +"}`).join("\n")}

export const decodeBlueNoise = (): Uint8Array =>
  Uint8Array.from(atob(BLUE_NOISE_BASE64), (char) => char.charCodeAt(0));
`,
);
