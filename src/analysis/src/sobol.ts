/**
 * SourceSink — Sobol' low-discrepancy sequence.
 *
 * Uses the standard Joe–Kuo direction numbers (new-joe-kuo-6.21201) for the
 * first 21 dimensions. Direction numbers are stored as 30-bit integers; the
 * Gray-code construction then gives the familiar sequence
 * (½, ½), (¾, ¼), (¼, ¾), … after the initial all-zero point is skipped.
 */

/** One dimension of the Joe–Kuo table: polynomial degree `s`, coefficient
 * integer `a` (its bits are a_1..a_{s-1}, most significant first), and the
 * initial direction numbers `m_1..m_s`. Dimension 1 (van der Corput) is
 * implicit. */
interface JoeKuo {
  s: number;
  a: number;
  m: number[];
}

/** Digits of precision carried by the direction numbers. */
const MAXBIT = 30;

/** new-joe-kuo-6.21201, dimensions 2 through 21. */
const JOE_KUO: JoeKuo[] = [
  { s: 1, a: 0, m: [1] },
  { s: 2, a: 1, m: [1, 3] },
  { s: 3, a: 1, m: [1, 3, 1] },
  { s: 3, a: 2, m: [1, 1, 1] },
  { s: 4, a: 1, m: [1, 1, 3, 3] },
  { s: 4, a: 4, m: [1, 3, 5, 13] },
  { s: 5, a: 2, m: [1, 1, 5, 5, 17] },
  { s: 5, a: 4, m: [1, 1, 5, 5, 5] },
  { s: 5, a: 7, m: [1, 1, 7, 11, 19] },
  { s: 5, a: 11, m: [1, 1, 5, 1, 1] },
  { s: 5, a: 13, m: [1, 1, 1, 3, 11] },
  { s: 5, a: 14, m: [1, 3, 5, 5, 31] },
  { s: 6, a: 1, m: [1, 3, 3, 9, 7, 49] },
  { s: 6, a: 13, m: [1, 1, 1, 15, 21, 21] },
  { s: 6, a: 16, m: [1, 3, 1, 13, 27, 49] },
  { s: 6, a: 19, m: [1, 1, 1, 15, 7, 5] },
  { s: 6, a: 22, m: [1, 3, 1, 15, 13, 25] },
  { s: 6, a: 25, m: [1, 1, 5, 5, 19, 61] },
  { s: 7, a: 1, m: [1, 3, 7, 11, 23, 15, 103] },
  { s: 7, a: 4, m: [1, 3, 7, 13, 13, 15, 69] },
];

/** Direction numbers v_1..v_MAXBIT for dimension `dim` (1-based). */
function directionNumbers(dim: number): number[] {
  const v = new Array<number>(MAXBIT + 1).fill(0);

  if (dim === 1) {
    for (let i = 1; i <= MAXBIT; i += 1) v[i] = 2 ** (MAXBIT - i);
    return v;
  }

  const { s, a, m } = JOE_KUO[dim - 2];
  for (let i = 1; i <= s; i += 1) v[i] = m[i - 1] * 2 ** (MAXBIT - i);
  for (let i = s + 1; i <= MAXBIT; i += 1) {
    // v_i = v_{i-s} xor (v_{i-s} >> s) xor the a-selected earlier terms.
    let x = v[i - s] ^ (v[i - s] >>> s);
    for (let k = 1; k <= s - 1; k += 1) {
      if ((a >>> (s - 1 - k)) & 1) x ^= v[i - k];
    }
    v[i] = x >>> 0;
  }
  return v;
}

/** Sobol' sequence in [0,1)^dim, dim ≤ 21, using the standard Joe–Kuo
 * (2008, new-joe-kuo-6.21201) direction numbers for the first 21 dimensions,
 * Gray-code construction, skipping the first point (all zeros) by default.
 * `skip` is the number of initial points omitted (0 includes the zeros). */
export function sobolSequence(n: number, dim: number, skip = 1): number[][] {
  if (!Number.isInteger(dim) || dim < 1 || dim > 21) {
    throw new Error(`Sobol' dimension must be an integer in [1, 21], got ${dim}`);
  }
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Sobol' point count must be a non-negative integer, got ${n}`);
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new Error(`Sobol' skip must be a non-negative integer, got ${skip}`);
  }
  const total = skip + n;
  if (total > 2 ** MAXBIT) {
    throw new Error(`Sobol' sequence length ${total} exceeds 2^${MAXBIT}`);
  }

  const v: number[][] = [];
  for (let d = 1; d <= dim; d += 1) v.push(directionNumbers(d));

  const scale = 2 ** MAXBIT;
  const x = new Array<number>(dim).fill(0);
  const out: number[][] = [];

  for (let j = 0; j < total; j += 1) {
    // X_0 is the all-zero point; later points xor one direction number into
    // the Gray code. The position (1-based) of the rightmost zero bit of j - 1
    // selects which direction number.
    if (j > 0) {
      let c = 1;
      let z = j - 1;
      while ((z & 1) === 1) {
        c += 1;
        z >>>= 1;
      }
      for (let d = 0; d < dim; d += 1) x[d] = (x[d] ^ v[d][c]) >>> 0;
    }
    if (j >= skip) out.push(x.map((xi) => xi / scale));
  }

  return out;
}
