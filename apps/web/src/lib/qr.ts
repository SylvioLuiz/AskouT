/**
 * Gerador de QR code (modo byte, correção M, versões 1 a 10), sem dependências.
 * Cabe um texto de até 213 bytes. Devolve a matriz de módulos (true = escuro).
 */

// Correção M de cada versão: [bytes de correção por bloco, [quantidade de blocos, bytes de dados por bloco][]].
const BLOCKS_M: Record<number, [number, [number, number][]]> = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};

const ALIGNMENT: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const MAX_VERSION = 10;

export function qrCapacityBytes(version: number): number {
  const [, groups] = BLOCKS_M[version]!;
  const data = groups.reduce((sum, [count, size]) => sum + count * size, 0);
  return Math.floor((data * 8 - 4 - (version >= 10 ? 16 : 8)) / 8);
}

// ---------- Reed-Solomon sobre GF(256) (polinômio 0x11D) ----------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

/** Bytes de correção de erro: resto da divisão dos dados pelo polinômio gerador de grau `degree`. */
export function reedSolomon(data: number[], degree: number): number[] {
  // Gerador (x - a^0)(x - a^1)...(x - a^(degree-1)), do maior grau para o menor, sem o coeficiente 1 do topo.
  const generator = new Array<number>(degree).fill(0);
  generator[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      generator[j] = gfMul(generator[j]!, root);
      if (j + 1 < degree) generator[j] = generator[j]! ^ generator[j + 1]!;
    }
    root = gfMul(root, 2);
  }
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] = result[i]! ^ gfMul(generator[i]!, factor);
  }
  return result;
}

// ---------- Montagem ----------

/** Bits de formato (nível M = 00 e máscara) com o código BCH e a máscara fixa da especificação. */
export function formatBits(mask: number): number {
  const data = mask; // nível M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const bit = (value: number, i: number): boolean => ((value >>> i) & 1) !== 0;

function buildCodewords(bytes: Uint8Array, version: number): number[] {
  const [ecPerBlock, groups] = BLOCKS_M[version]!;
  const dataTotal = groups.reduce((sum, [count, size]) => sum + count * size, 0);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataTotal * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataTotal; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const chunk = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ data: chunk, ec: reedSolomon(chunk, ecPerBlock) });
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]!);
  for (let i = 0; i < ecPerBlock; i++) for (const b of blocks) out.push(b.ec[i]!);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const FINDER_A = [true, false, true, true, true, false, true, false, false, false, false];
const FINDER_B = [false, false, false, false, true, false, true, true, true, false, true];

function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
    for (let i = 0; i + 11 <= size; i++) {
      let okA = true;
      let okB = true;
      for (let k = 0; k < 11; k++) {
        const v = get(i + k);
        if (v !== FINDER_A[k]) okA = false;
        if (v !== FINDER_B[k]) okB = false;
      }
      if (okA) score += 40;
      if (okB) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((i) => m[y]![i]!);
  for (let x = 0; x < size; x++) line((i) => m[i]![x]!);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y]![x] === m[y]![x + 1] && m[y]![x] === m[y + 1]![x] && m[y]![x] === m[y + 1]![x + 1]) score += 3;
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** Matriz do QR code do texto (UTF-8). Lança se passar de 213 bytes. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= MAX_VERSION && qrCapacityBytes(version) < bytes.length) version++;
  if (version > MAX_VERSION) throw new Error('Texto grande demais para o QR code');
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    fixed[y]![x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const pos = ALIGNMENT[version]!;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (mask: number) => {
    const bits = formatBits(mask);
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6));
    set(8, 8, bit(bits, 7));
    set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }

  const codewords = buildCodewords(bytes, version);
  const dataBits: boolean[] = [];
  for (const c of codewords) for (let i = 7; i >= 0; i--) dataBits.push(((c >>> i) & 1) !== 0);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y]![x]) {
          modules[y]![x] = k < dataBits.length ? dataBits[k]! : false;
          k++;
        }
      }
    }
  }
  if (k < dataBits.length) throw new Error('QR code: os dados não couberam');

  let best = 0;
  let bestScore = Infinity;
  const apply = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y]![x] && MASKS[mask]!(x, y)) modules[y]![x] = !modules[y]![x];
  };
  for (let mask = 0; mask < 8; mask++) {
    apply(mask);
    drawFormat(mask);
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
    apply(mask);
  }
  apply(best);
  drawFormat(best);
  return modules;
}

/** SVG do QR code com `quiet` módulos de margem clara (a especificação pede 4). */
export function qrSvg(matrix: boolean[][], quiet = 4): string {
  const n = matrix.length + quiet * 2;
  let path = '';
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      path += `M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
