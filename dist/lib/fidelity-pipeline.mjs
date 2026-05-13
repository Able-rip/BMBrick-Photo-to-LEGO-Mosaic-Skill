export const DEFAULT_WORKSPACE_PRESET = Object.freeze({
  routeKey: "lego",
  partId: "3024",
  materialMode: "square_1x1",
  format: "square",
  baseplatePreset: Object.freeze({ cols: 96, rows: 96, plateSize: 48 }),
  ditheringMode: "subtle",
  colorFilter: "all"
});

const _DS = Object.freeze({ off: 0, strong: 1, subtle: 0.38 });

export function getDitheringStrength(mode = "subtle") {
  return _DS[mode] ?? _DS.subtle;
}

export function getAdaptiveBlendMix(options = {}) {
  const {
    localSpread = 0,
    ditheringMode = "subtle",
    materialMode = "square_1x1"
  } = options;

  const _bm = _DS[ditheringMode] === 1 ? 0.68 : _DS[ditheringMode] === 0 ? 0.18 : 0.36;
  const _eb = Math.min(1, Math.max(0, localSpread / 120)) * (materialMode === "square_1x1" ? 0.34 : 0.32);
  return Math.min(0.88, _bm + _eb);
}

export function smoothImageData(data, width, height, options = {}) {
  const {
    passes = 1,
    strength = 0.4,
    alphaThreshold = 20
  } = options;

  let current = new Uint8ClampedArray(data);

  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8ClampedArray(current);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (current[index + 3] < alphaThreshold) {
          continue;
        }

        let totalWeight = 0;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;

        for (let ny = -1; ny <= 1; ny += 1) {
          for (let nx = -1; nx <= 1; nx += 1) {
            const px = x + nx;
            const py = y + ny;
            if (px < 0 || px >= width || py < 0 || py >= height) {
              continue;
            }

            const neighborIndex = (py * width + px) * 4;
            if (current[neighborIndex + 3] < alphaThreshold) {
              continue;
            }

            const weight = nx === 0 && ny === 0 ? 4 : (nx === 0 || ny === 0 ? 2 : 1);
            totalWeight += weight;
            sumR += current[neighborIndex] * weight;
            sumG += current[neighborIndex + 1] * weight;
            sumB += current[neighborIndex + 2] * weight;
          }
        }

        if (!totalWeight) {
          continue;
        }

        const avgR = sumR / totalWeight;
        const avgG = sumG / totalWeight;
        const avgB = sumB / totalWeight;

        next[index] = Math.round((current[index] * (1 - strength)) + (avgR * strength));
        next[index + 1] = Math.round((current[index + 1] * (1 - strength)) + (avgG * strength));
        next[index + 2] = Math.round((current[index + 2] * (1 - strength)) + (avgB * strength));
      }
    }

    current = next;
  }

  return current;
}

export function bilateralFilter(data, width, height, options = {}) {
  const {
    radius = 2,
    sigmaSpace = 2.0,
    sigmaColor = 30.0,
    alphaThreshold = 20
  } = options;

  const result = new Uint8ClampedArray(data);
  const _sc = -0.5 / (sigmaSpace * sigmaSpace);
  const _cc = -0.5 / (sigmaColor * sigmaColor);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < alphaThreshold) {
        continue;
      }

      const cR = data[index];
      const cG = data[index + 1];
      const cB = data[index + 2];

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let wSum = 0;

      for (let ny = -radius; ny <= radius; ny += 1) {
        for (let nx = -radius; nx <= radius; nx += 1) {
          const px = x + nx;
          const py = y + ny;
          if (px < 0 || px >= width || py < 0 || py >= height) {
            continue;
          }

          const nIdx = (py * width + px) * 4;
          if (data[nIdx + 3] < alphaThreshold) {
            continue;
          }

          const nR = data[nIdx];
          const nG = data[nIdx + 1];
          const nB = data[nIdx + 2];

          const spatialDist = nx * nx + ny * ny;
          const colorDist = (cR - nR) ** 2 + (cG - nG) ** 2 + (cB - nB) ** 2;

          const w = Math.exp(spatialDist * _sc + colorDist * _cc);
          sumR += nR * w;
          sumG += nG * w;
          sumB += nB * w;
          wSum += w;
        }
      }

      if (wSum > 0) {
        result[index] = Math.round(sumR / wSum);
        result[index + 1] = Math.round(sumG / wSum);
        result[index + 2] = Math.round(sumB / wSum);
      }
    }
  }

  return result;
}

function _clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function _htr(hex) {
  const n = hex.replace("#", "");
  return {
    r: Number.parseInt(n.slice(0, 2), 16),
    g: Number.parseInt(n.slice(2, 4), 16),
    b: Number.parseInt(n.slice(4, 6), 16)
  };
}

function _lum(rgb) {
  return (rgb.r * 0.299) + (rgb.g * 0.587) + (rgb.b * 0.114);
}

export function applyLightPieceCompensation(rgb, options = {}, localSpread = 0, boardRgb = null) {
  const {
    enabled = false,
    thresholdLuma = 220,
    darkenRatio = 0.08
  } = options;

  if (!enabled) {
    return { ...rgb };
  }

  const luma = _lum(rgb);
  if (luma < thresholdLuma) {
    return { ...rgb };
  }

  const boardLuma = boardRgb ? _lum(boardRgb) : 255;
  const _bp = Math.max(0, 1 - Math.min(1, Math.abs(luma - boardLuma) / 40));
  const _ep = Math.max(0.2, 1 - Math.min(1, localSpread / 120));
  const ratio = darkenRatio * (0.7 + _bp * 0.6) * _ep;

  return {
    r: _clamp(rgb.r * (1 - ratio)),
    g: _clamp(rgb.g * (1 - ratio)),
    b: _clamp(rgb.b * (1 - ratio))
  };
}

export function applyBoardCompensationToRgb(rgb, options = {}) {
  const {
    enabled = false,
    backgroundHex = "#F3EFE7"
  } = options;

  if (!enabled) {
    return { ...rgb };
  }

  const board = _htr(backgroundHex);
  const diff = Math.abs(rgb.r - board.r) + Math.abs(rgb.g - board.g) + Math.abs(rgb.b - board.b);
  if (diff > 48) {
    return { ...rgb };
  }

  return {
    r: _clamp(rgb.r * 0.98),
    g: _clamp(rgb.g * 0.98),
    b: _clamp(rgb.b * 0.98)
  };
}

export function buildReliefMask(data, width, height) {
  const mask = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 20) {
        mask[(y * width) + x] = 0;
        continue;
      }

      const centerLuma = _lum({
        r: data[index],
        g: data[index + 1],
        b: data[index + 2]
      });
      let maxDelta = 0;

      for (let ny = -1; ny <= 1; ny += 1) {
        for (let nx = -1; nx <= 1; nx += 1) {
          if (nx === 0 && ny === 0) {
            continue;
          }
          const px = x + nx;
          const py = y + ny;
          if (px < 0 || px >= width || py < 0 || py >= height) {
            continue;
          }
          const neighborIndex = (py * width + px) * 4;
          if (data[neighborIndex + 3] < 20) {
            continue;
          }
          const neighborLuma = _lum({
            r: data[neighborIndex],
            g: data[neighborIndex + 1],
            b: data[neighborIndex + 2]
          });
          maxDelta = Math.max(maxDelta, Math.abs(centerLuma - neighborLuma));
        }
      }

      mask[(y * width) + x] = _clamp((maxDelta / 160) * 255);
    }
  }

  return mask;
}

const _CP = Object.freeze({ sq: 8e-3, rd: 3e-3 });

export function continuityPenalty(options = {}) {
  const {
    candidateId,
    leftId = null,
    topId = null,
    materialMode = "square_1x1"
  } = options;

  const _bp = materialMode === "square_1x1" ? _CP.sq : _CP.rd;
  let penalty = 0;

  if (leftId && candidateId !== leftId) {
    penalty += _bp;
  }
  if (topId && candidateId !== topId) {
    penalty += _bp * 0.85;
  }
  if (leftId && topId && leftId === topId && candidateId !== leftId) {
    penalty += _bp * 0.5;
  }

  return penalty;
}

export function blendQuantizationSample(options = {}) {
  const {
    working = { r: 0, g: 0, b: 0 },
    smooth = working,
    ditheringMode = "subtle",
    materialMode = "square_1x1",
    localSpread = 0
  } = options;

  const workingMix = getAdaptiveBlendMix({
    localSpread,
    ditheringMode,
    materialMode
  });
  const smoothMix = 1 - workingMix;

  return {
    r: Math.round((working.r * workingMix) + (smooth.r * smoothMix)),
    g: Math.round((working.g * workingMix) + (smooth.g * smoothMix)),
    b: Math.round((working.b * workingMix) + (smooth.b * smoothMix))
  };
}
