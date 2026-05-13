/* ── internal color-transform utilities ── */

/**
 * OKLab Color Space Conversion
 * Copyright (c) 2020 Björn Ottosson
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const _K = 1e10;

const _R0 = [4122214708, 5363325363, 514459929];
const _R1 = [2119034982, 6806995451, 1073969566];
const _R2 = [883024619, 2817188376, 6299787005];

const _C = [
  2104542553, 7936177850, 40720468,
  19779984951, 24285922050, 4505937099,
  259040371, 7827717662, 8086757660
];

function _nh(h) {
  const s = String(h || "").trim().replace(/^#/, "");
  if (s.length === 3) {
    return s.split("").map(c => c + c).join("").toUpperCase();
  }
  if (s.length !== 6) {
    throw new Error(`Invalid input: "${h}"`);
  }
  return s.toUpperCase();
}

export function hexToRgb(hex) {
  const n = _nh(hex);
  return {
    r: Number.parseInt(n.slice(0, 2), 16),
    g: Number.parseInt(n.slice(2, 4), 16),
    b: Number.parseInt(n.slice(4, 6), 16)
  };
}

function _lin(ch) {
  const v = ch / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export const srgbChannelToLinear = _lin;

export function rgbToOklab(r, g, b) {
  const _l = _lin(r), _m = _lin(g), _s = _lin(b);

  const p = [_R0, _R1, _R2].map(row =>
    Math.cbrt((row[0] / _K) * _l + (row[1] / _K) * _m + (row[2] / _K) * _s)
  );

  return {
    L: (_C[0] / _K) * p[0] + (_C[1] / _K) * p[1] - (_C[2] / _K) * p[2],
    a: (_C[3] / _K) * p[0] - (_C[4] / _K) * p[1] + (_C[5] / _K) * p[2],
    b: (_C[6] / _K) * p[0] + (_C[7] / _K) * p[1] - (_C[8] / _K) * p[2]
  };
}

export function hexToOklab(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToOklab(r, g, b);
}

export function oklabDistance(a, b) {
  const d0 = a.L - b.L;
  const d1 = a.a - b.a;
  const d2 = a.b - b.b;
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

export function weightedOklabDistance(a, b) {
  const d0 = a.L - b.L;
  const d1 = a.a - b.a;
  const d2 = a.b - b.b;
  return Math.sqrt(d0 * d0 + (9 / 5) * (d1 * d1 + d2 * d2));
}
