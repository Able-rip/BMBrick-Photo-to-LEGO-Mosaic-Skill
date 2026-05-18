import {
  hexToRgb,
  rgbToOklab
} from "./color-science.mjs";
import {
  getDitheringStrength,
  bilateralFilter,
  continuityPenalty,
  applyLightPieceCompensation,
  applyBoardCompensationToRgb,
  buildReliefMask
} from "./fidelity-pipeline.mjs";

const LIGHTNESS_WEIGHT = 0.8;
const ALPHA_THRESHOLD = 20;
const MATERIAL_RAMP_PENALTY = 0.14;

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function colorIdFor(color) {
  return color.canonical_color_id ?? color.bricklink_color_id ?? color.id ?? color.bl_id;
}

function rgbLuma(r, g, b) {
  return (r * 0.299) + (g * 0.587) + (b * 0.114);
}

function lumaAt(data, width, height, x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  const index = (y * width + x) * 4;
  if (data[index + 3] < ALPHA_THRESHOLD) return null;
  return rgbLuma(data[index], data[index + 1], data[index + 2]);
}

function getLocalSpread(data, width, height, x, y, radius = 1) {
  let mn = 255;
  let mx = 0;
  let seen = false;
  for (let ny = -radius; ny <= radius; ny += 1) {
    for (let nx = -radius; nx <= radius; nx += 1) {
      const luma = lumaAt(data, width, height, x + nx, y + ny);
      if (luma === null) continue;
      seen = true;
      if (luma < mn) mn = luma;
      if (luma > mx) mx = luma;
    }
  }
  return seen ? mx - mn : 0;
}

function getEdgeMagnitude(data, width, height, x, y) {
  const center = lumaAt(data, width, height, x, y);
  if (center === null) return 0;
  const left = lumaAt(data, width, height, x - 1, y) ?? center;
  const right = lumaAt(data, width, height, x + 1, y) ?? center;
  const top = lumaAt(data, width, height, x, y - 1) ?? center;
  const bottom = lumaAt(data, width, height, x, y + 1) ?? center;
  return Math.max(Math.abs(right - left), Math.abs(bottom - top));
}

function boxFilter(data, width, height, radius) {
  const result = new Float32Array(data.length);
  const w = 2 * radius + 1;
  const invArea = 1 / (w * w);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (let ny = -radius; ny <= radius; ny += 1) {
        for (let nx = -radius; nx <= radius; nx += 1) {
          const px = x + nx;
          const py = y + ny;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          const idx = (py * width + px) * 4;
          if (data[idx + 3] < ALPHA_THRESHOLD) continue;
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          count += 1;
        }
      }
      const outIdx = (y * width + x) * 4;
      if (count > 0) {
        result[outIdx] = sumR / count;
        result[outIdx + 1] = sumG / count;
        result[outIdx + 2] = sumB / count;
        result[outIdx + 3] = 255;
      }
    }
  }
  return result;
}

function guidedFilter(input, guide, width, height, radius, epsilon) {
  const inputLab = new Float32Array(width * height * 3);
  const guideLab = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    const li = rgbToOklab(input[idx], input[idx + 1], input[idx + 2]);
    inputLab[i * 3] = li.L;
    inputLab[i * 3 + 1] = li.a;
    inputLab[i * 3 + 2] = li.b;
    const lg = rgbToOklab(guide[idx], guide[idx + 1], guide[idx + 2]);
    guideLab[i * 3] = lg.L;
    guideLab[i * 3 + 1] = lg.a;
    guideLab[i * 3 + 2] = lg.b;
  }

  const result = new Uint8ClampedArray(input.length);
  for (let c = 0; c < 3; c += 1) {
    const iPlane = new Float32Array(width * height);
    const gPlane = new Float32Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      iPlane[i] = inputLab[i * 3 + c];
      gPlane[i] = guideLab[i * 3 + c];
    }
    const iBox = boxFilterFlat(iPlane, width, height, radius);
    const gBox = boxFilterFlat(gPlane, width, height, radius);
    const igBox = boxFilterFlatProduct(iPlane, gPlane, width, height, radius);
    const iiBox = boxFilterFlatProduct(iPlane, iPlane, width, height, radius);

    const a = new Float32Array(width * height);
    const b = new Float32Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      const covIG = igBox[i] - gBox[i] * iBox[i];
      const varG = iiBox[i] - gBox[i] * gBox[i];
      a[i] = covIG / (varG + epsilon);
      b[i] = iBox[i] - a[i] * gBox[i];
    }

    const aBox = boxFilterFlat(a, width, height, radius);
    const bBox = boxFilterFlat(b, width, height, radius);

    for (let i = 0; i < width * height; i += 1) {
      const outIdx = i * 4;
      result[outIdx + c] = clampByte(aBox[i] * gPlane[i] + bBox[i]);
    }
  }
  for (let i = 0; i < width * height; i += 1) {
    result[i * 4 + 3] = input[i * 4 + 3];
  }
  return result;
}

function boxFilterFlat(data, width, height, radius) {
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let ny = -radius; ny <= radius; ny += 1) {
        for (let nx = -radius; nx <= radius; nx += 1) {
          const px = x + nx;
          const py = y + ny;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          sum += data[py * width + px];
          count += 1;
        }
      }
      result[y * width + x] = count > 0 ? sum / count : 0;
    }
  }
  return result;
}

function boxFilterFlatProduct(a, b, width, height, radius) {
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let ny = -radius; ny <= radius; ny += 1) {
        for (let nx = -radius; nx <= radius; nx += 1) {
          const px = x + nx;
          const py = y + ny;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          sum += a[py * width + px] * b[py * width + px];
          count += 1;
        }
      }
      result[y * width + x] = count > 0 ? sum / count : 0;
    }
  }
  return result;
}

function guidedFilterRgb(input, guide, width, height, radius, epsilon) {
  const result = new Uint8ClampedArray(input.length);
  for (let c = 0; c < 3; c += 1) {
    const iPlane = new Float32Array(width * height);
    const gPlane = new Float32Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      iPlane[i] = input[i * 4 + c];
      gPlane[i] = guide[i * 4 + c];
    }
    const iBox = boxFilterFlat(iPlane, width, height, radius);
    const gBox = boxFilterFlat(gPlane, width, height, radius);
    const igBox = boxFilterFlatProduct(iPlane, gPlane, width, height, radius);
    const iiBox = boxFilterFlatProduct(iPlane, iPlane, width, height, radius);

    const a = new Float32Array(width * height);
    const bArr = new Float32Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      const covIG = igBox[i] - gBox[i] * iBox[i];
      const varG = iiBox[i] - gBox[i] * gBox[i];
      a[i] = covIG / (varG + epsilon);
      bArr[i] = iBox[i] - a[i] * gBox[i];
    }

    const aBox = boxFilterFlat(a, width, height, radius);
    const bBox = boxFilterFlat(bArr, width, height, radius);

    for (let i = 0; i < width * height; i += 1) {
      result[i * 4 + c] = clampByte(aBox[i] * gPlane[i] + bBox[i]);
    }
  }
  for (let i = 0; i < width * height; i += 1) {
    result[i * 4 + 3] = input[i * 4 + 3];
  }
  return result;
}

function reQuantizeToPalette(filtered, paletteLab, colors, width, height) {
  const output = new Uint8ClampedArray(filtered.length);
  const selectedIds = new Array(width * height).fill(null);
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    if (filtered[idx + 3] < ALPHA_THRESHOLD) {
      output[idx + 3] = 0;
      continue;
    }
    const lab = rgbToOklab(filtered[idx], filtered[idx + 1], filtered[idx + 2]);
    let bestDist = Number.POSITIVE_INFINITY;
    let bestIdx = 0;
    for (let j = 0; j < colors.length; j += 1) {
      const off = j * 3;
      const dL = lab.L - paletteLab[off];
      const dA = lab.a - paletteLab[off + 1];
      const dB = lab.b - paletteLab[off + 2];
      const dist = (LIGHTNESS_WEIGHT * dL * dL) + (dA * dA) + (dB * dB);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
      }
    }
    const rgb = hexToRgb(colors[bestIdx].hex);
    output[idx] = rgb.r;
    output[idx + 1] = rgb.g;
    output[idx + 2] = rgb.b;
    output[idx + 3] = 255;
    selectedIds[i] = colorIdFor(colors[bestIdx]);
  }
  return { output, selectedIds };
}

export function classifyRegion(metrics = {}) {
  const {
    localSpread = 0,
    mediumSpread = 0,
    edgeMagnitude = 0,
    quantizationError = 0,
    transparent = false
  } = metrics;

  if (transparent) return "transparent";
  if (edgeMagnitude >= 28 || localSpread >= 34) return "detail";
  if (localSpread < 4 && mediumSpread < 12 && edgeMagnitude < 8) return "flat";
  if (quantizationError >= 0.055 || mediumSpread >= 18) return "gradient";
  return "gradient";
}

export function getRegionalQuantizePolicy(region, ditheringMode = "subtle") {
  const strength = getDitheringStrength(ditheringMode);
  if (region === "flat") {
    return {
      strength,
      penaltyMultiplier: 6,
      ditherFloor: 0,
      ditherScale: 0.16,
      edgeProtection: 0,
      cleanupEligible: true
    };
  }
  if (region === "detail") {
    return {
      strength,
      penaltyMultiplier: 0.75,
      ditherFloor: 0.04,
      ditherScale: 0.58,
      edgeProtection: 1,
      cleanupEligible: false
    };
  }
  return {
    strength,
    penaltyMultiplier: 1,
    ditherFloor: 0.08,
    ditherScale: 0.92,
    edgeProtection: 0.35,
    cleanupEligible: false
  };
}

export function analyzeRegionMap(data, width, height) {
  const regionMap = new Array(width * height);
  const alphaMask = new Uint8Array(width * height);
  const localSpreadMap = new Float32Array(width * height);
  const mediumSpreadMap = new Float32Array(width * height);
  const edgeMap = new Float32Array(width * height);
  const regionCounts = { flat: 0, gradient: 0, detail: 0, transparent: 0 };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * width + x;
      const index = offset * 4;
      if (data[index + 3] < ALPHA_THRESHOLD) {
        regionMap[offset] = "transparent";
        regionCounts.transparent += 1;
        continue;
      }
      alphaMask[offset] = 1;
      const localSpread = getLocalSpread(data, width, height, x, y, 1);
      const mediumSpread = getLocalSpread(data, width, height, x, y, 2);
      const edgeMagnitude = getEdgeMagnitude(data, width, height, x, y);
      const region = classifyRegion({ localSpread, mediumSpread, edgeMagnitude });

      localSpreadMap[offset] = localSpread;
      mediumSpreadMap[offset] = mediumSpread;
      edgeMap[offset] = edgeMagnitude;
      regionMap[offset] = region;
      regionCounts[region] += 1;
    }
  }

  return { regionMap, alphaMask, localSpreadMap, mediumSpreadMap, edgeMap, regionCounts };
}

function buildPalette(colors) {
  const lab = new Float32Array(colors.length * 3);
  const colorsById = new Map();
  for (let i = 0; i < colors.length; i += 1) {
    const rgb = hexToRgb(colors[i].hex);
    const labColor = rgbToOklab(rgb.r, rgb.g, rgb.b);
    lab[i * 3] = labColor.L;
    lab[i * 3 + 1] = labColor.a;
    lab[i * 3 + 2] = labColor.b;
    colorsById.set(colorIdFor(colors[i]), colors[i]);
  }
  return { lab, colorsById };
}

function normalizeLocalManifoldConfig(spatialStabilization = {}) {
  const config = {
    enabled: false,
    radius: 1,
    weight: 0.9,
    maxLocalSpread: 7,
    maxMediumSpread: 16,
    maxEdge: 10,
    minAllowedDistance: 0.018,
    distanceMargin: 0.018,
    distanceScale: 1.8,
    chromaMargin: 0.022,
    maxMeanChroma: 0.085,
    ...(spatialStabilization.localManifold && typeof spatialStabilization.localManifold === "object"
      ? spatialStabilization.localManifold
      : {})
  };
  if (spatialStabilization.localManifold === true) config.enabled = true;
  config.radius = Math.max(1, Math.floor(config.radius));
  config.weight = Math.max(0, config.weight);
  return config;
}

function weightedOklabDistance(a, b, lightnessWeight = LIGHTNESS_WEIGHT) {
  return Math.sqrt(
    (lightnessWeight * ((a.L - b.L) ** 2)) +
    ((a.a - b.a) ** 2) +
    ((a.b - b.b) ** 2)
  );
}

export function getLocalManifoldBias({ data, width, height, x, y, analysis, config }) {
  const resolvedConfig = {
    radius: 1,
    weight: 0.9,
    maxLocalSpread: 7,
    maxMediumSpread: 16,
    maxEdge: 10,
    minAllowedDistance: 0.018,
    distanceMargin: 0.018,
    distanceScale: 1.8,
    chromaMargin: 0.022,
    maxMeanChroma: 0.085,
    ...config
  };
  if (!resolvedConfig.enabled || resolvedConfig.weight <= 0) return null;
  const offset = (y * width) + x;
  if (analysis?.regionMap?.[offset] !== "flat") return null;
  if ((analysis.localSpreadMap?.[offset] ?? 0) > resolvedConfig.maxLocalSpread) return null;
  if ((analysis.mediumSpreadMap?.[offset] ?? 0) > resolvedConfig.maxMediumSpread) return null;
  if ((analysis.edgeMap?.[offset] ?? 0) > resolvedConfig.maxEdge) return null;

  const labs = [];
  for (let ny = -resolvedConfig.radius; ny <= resolvedConfig.radius; ny += 1) {
    for (let nx = -resolvedConfig.radius; nx <= resolvedConfig.radius; nx += 1) {
      const px = x + nx;
      const py = y + ny;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const idx = (py * width + px) * 4;
      if (data[idx + 3] < ALPHA_THRESHOLD) continue;
      labs.push(rgbToOklab(data[idx], data[idx + 1], data[idx + 2]));
    }
  }
  if (labs.length < 4) return null;

  const meanLab = labs.reduce((sum, lab) => {
    sum.L += lab.L;
    sum.a += lab.a;
    sum.b += lab.b;
    return sum;
  }, { L: 0, a: 0, b: 0 });
  meanLab.L /= labs.length;
  meanLab.a /= labs.length;
  meanLab.b /= labs.length;

  const meanChroma = Math.hypot(meanLab.a, meanLab.b);
  if (meanChroma > resolvedConfig.maxMeanChroma) return null;

  let distanceTotal = 0;
  let chromaMax = 0;
  for (const lab of labs) {
    distanceTotal += weightedOklabDistance(lab, meanLab);
    chromaMax = Math.max(chromaMax, Math.hypot(lab.a, lab.b));
  }

  return {
    meanLab,
    allowedDistance: Math.max(
      resolvedConfig.minAllowedDistance,
      (distanceTotal / labs.length) * resolvedConfig.distanceScale + resolvedConfig.distanceMargin
    ),
    chromaLimit: Math.max(chromaMax, meanChroma) + resolvedConfig.chromaMargin,
    weight: resolvedConfig.weight
  };
}

export function scoreLocalManifoldPenalty({ candidateLab = null, candidateRgb = null, bias }) {
  if (!bias) return 0;
  const lab = candidateLab ?? rgbToOklab(candidateRgb.r, candidateRgb.g, candidateRgb.b);
  const distanceExcess = Math.max(0, weightedOklabDistance(lab, bias.meanLab) - bias.allowedDistance);
  const chromaExcess = Math.max(0, Math.hypot(lab.a, lab.b) - bias.chromaLimit);
  return bias.weight * (distanceExcess + (0.75 * chromaExcess));
}

function getClosestColor(r, g, b, options) {
  const {
    colors,
    paletteLab,
    previousColorId = null,
    topColorId = null,
    materialMode = "square_1x1",
    penaltyMultiplier = 1,
    rampBias = null,
    blockAnchorLab = null,
    blockAnchorWeight = 0,
    localManifoldBias = null,
    darkCpBoost = 1,
    darkLuminanceThreshold = 0.25,
    lightnessWeight = LIGHTNESS_WEIGHT
  } = options;
  const lab = rgbToOklab(r, g, b);
  const effectivePenaltyMult = penaltyMultiplier * (lab.L < darkLuminanceThreshold ? darkCpBoost : 1);
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestIdx = 0;

  for (let i = 0; i < colors.length; i += 1) {
    const off = i * 3;
    const dL = lab.L - paletteLab[off];
    const dA = lab.a - paletteLab[off + 1];
    const dB = lab.b - paletteLab[off + 2];
    const dist = Math.sqrt((lightnessWeight * dL * dL) + (dA * dA) + (dB * dB));
    const candidateId = colorIdFor(colors[i]);
    const penalty = continuityPenalty({
      candidateId,
      leftId: previousColorId,
      topId: topColorId,
      materialMode
    }) * effectivePenaltyMult;
    const rampPenalty = rampBias?.weight > 0 && !rampBias.allowedIds.has(candidateId)
      ? rampBias.weight * rampBias.penalty
      : 0;
    let blockPenalty = 0;
    if (blockAnchorLab && blockAnchorWeight > 0) {
      const bL = blockAnchorLab[0] - paletteLab[off];
      const bA = blockAnchorLab[1] - paletteLab[off + 1];
      const bB = blockAnchorLab[2] - paletteLab[off + 2];
      blockPenalty = blockAnchorWeight * Math.sqrt((lightnessWeight * bL * bL) + (bA * bA) + (bB * bB));
    }
    const manifoldPenalty = scoreLocalManifoldPenalty({
      candidateLab: { L: paletteLab[off], a: paletteLab[off + 1], b: paletteLab[off + 2] },
      bias: localManifoldBias
    });
    const score = dist + penalty + rampPenalty + blockPenalty + manifoldPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestDist = dist;
      bestIdx = i;
    }
  }

  return { closestColor: colors[bestIdx], distance: bestDist };
}

function sharpen(data, width, height) {
  const amount = 0.4;
  const copy = new Uint8ClampedArray(data);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const top = copy[((y - 1) * width + x) * 4 + c];
        const bottom = copy[((y + 1) * width + x) * 4 + c];
        const left = copy[(y * width + (x - 1)) * 4 + c];
        const right = copy[(y * width + (x + 1)) * 4 + c];
        const center = copy[index + c];
        const edge = (center * 4) - top - bottom - left - right;
        data[index + c] = clampByte(center + edge * amount);
      }
    }
  }
}

function toneMap(data) {
  const histogram = new Uint32Array(256);
  let pixelCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_THRESHOLD) continue;
    const luma = Math.round((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114));
    histogram[luma] += 1;
    pixelCount += 1;
  }

  let cumulative = 0;
  let highlightLevel = 255;
  const threshold = pixelCount * 0.97;
  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= threshold) {
      highlightLevel = i;
      break;
    }
  }

  const knee = Math.max(130, Math.min(190, highlightLevel - 35));
  const ceiling = 235;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_THRESHOLD) continue;
    for (let c = 0; c < 3; c += 1) {
      const value = data[i + c];
      if (value <= knee) continue;
      const t = (value - knee) / (255 - knee);
      data[i + c] = clampByte(Math.min(ceiling, knee + (ceiling - knee) * Math.sqrt(t)));
    }
  }
}

function colorRecordFor(color) {
  const rgb = hexToRgb(color.hex);
  const luma = rgbLuma(rgb.r, rgb.g, rgb.b);
  const coolScore = (rgb.g + rgb.b) - (2 * rgb.r);
  const warmScore = rgb.r - rgb.b;
  return {
    color,
    colorId: colorIdFor(color),
    rgb,
    luma,
    coolScore,
    warmScore
  };
}

function isSkinLikeCell(r, g, b, x, y, width, height) {
  const luma = rgbLuma(r, g, b);
  const nx = (x + 0.5) / width;
  const ny = (y + 0.5) / height;
  const centralPortraitBand = nx > 0.24 && nx < 0.76 && ny > 0.10 && ny < 0.70;
  return centralPortraitBand && luma > 58 && luma < 220 && r > b + 6 && r > g - 16;
}

function isLowerMaterialCandidate(r, g, b, x, y, width, height) {
  const luma = rgbLuma(r, g, b);
  const nx = (x + 0.5) / width;
  const ny = (y + 0.5) / height;
  if (ny < 0.58 || nx < 0.03 || nx > 0.97) return false;
  if (luma > 132) return false;
  return !isSkinLikeCell(r, g, b, x, y, width, height);
}

function trimmedAnchor(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a.luma - b.luma);
  const start = Math.floor(sorted.length * 0.20);
  const end = Math.max(start + 1, Math.ceil(sorted.length * 0.80));
  const trimmed = sorted.slice(start, end);
  const sum = trimmed.reduce((acc, sample) => {
    acc.r += sample.r;
    acc.g += sample.g;
    acc.b += sample.b;
    acc.luma += sample.luma;
    return acc;
  }, { r: 0, g: 0, b: 0, luma: 0 });
  return {
    r: sum.r / trimmed.length,
    g: sum.g / trimmed.length,
    b: sum.b / trimmed.length,
    luma: sum.luma / trimmed.length,
    sampleCount: samples.length,
    trimmedCount: trimmed.length
  };
}

function circularBinDistance(a, b, bins) {
  const diff = Math.abs(a - b);
  return Math.min(diff, bins - diff);
}

function sampleChromaDescriptor(sample) {
  const lab = rgbToOklab(sample.r, sample.g, sample.b);
  const chroma = Math.hypot(lab.a, lab.b);
  const bins = 16;
  const angle = Math.atan2(lab.b, lab.a);
  const normalized = (angle + Math.PI) / (Math.PI * 2);
  return {
    ...sample,
    lab,
    chroma,
    chromaBin: Math.min(bins - 1, Math.floor(normalized * bins))
  };
}

function dominantChromaComponentAnchor(samples, width, height) {
  if (!samples.length) return null;
  const bins = 16;
  const enriched = samples.map(sampleChromaDescriptor);
  const byOffset = new Map(enriched.map((sample) => [sample.offset, sample]));
  const seen = new Set();
  let bestComponent = [];

  for (const sample of enriched) {
    if (seen.has(sample.offset)) continue;
    const queue = [sample];
    const component = [];
    seen.add(sample.offset);

    while (queue.length) {
      const current = queue.pop();
      component.push(current);
      for (const neighborOffset of getFourNeighborIndexes(width, height, current.x, current.y)) {
        const neighbor = byOffset.get(neighborOffset);
        if (!neighbor || seen.has(neighbor.offset)) continue;
        if (circularBinDistance(current.chromaBin, neighbor.chromaBin, bins) > 1) continue;
        seen.add(neighbor.offset);
        queue.push(neighbor);
      }
    }

    if (component.length > bestComponent.length) {
      bestComponent = component;
    }
  }

  return trimmedAnchor(bestComponent);
}

function chromaAlignment(sample, anchor) {
  const sampleLab = sample.lab ?? rgbToOklab(sample.r, sample.g, sample.b);
  const anchorLab = anchor.lab ?? rgbToOklab(anchor.r, anchor.g, anchor.b);
  const sampleChroma = Math.hypot(sampleLab.a, sampleLab.b);
  const anchorChroma = Math.hypot(anchorLab.a, anchorLab.b);
  if (anchorChroma < 0.01) return 1;
  if (sampleChroma < 0.008) return sample.luma <= anchor.luma + 18 ? 0.65 : 0;
  return ((sampleLab.a * anchorLab.a) + (sampleLab.b * anchorLab.b)) / (sampleChroma * anchorChroma);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function materialPriorWeight(sample, anchor, analysis = null) {
  const alignment = chromaAlignment(sample, anchor);
  if (alignment < 0.35) return 0;

  const alignmentWeight = clamp01((alignment - 0.35) / 0.5);
  if (!analysis) return alignmentWeight;

  const edge = analysis.edgeMap?.[sample.offset] ?? 0;
  const localSpread = analysis.localSpreadMap?.[sample.offset] ?? 0;
  const mediumSpread = analysis.mediumSpreadMap?.[sample.offset] ?? 0;
  const detailSignal = Math.max(edge / 42, localSpread / 55, mediumSpread / 78);
  const detailExcess = clamp01((detailSignal - 0.72) / 0.65);
  const lightnessResidual = clamp01((sample.luma - anchor.luma - 20) / 36);
  const detailDecay = 1 - (0.94 * detailExcess * lightnessResidual);

  return alignmentWeight * clamp01(detailDecay);
}

function materialFamilyForAnchor(anchor) {
  const coolScore = (anchor.g + anchor.b) - (2 * anchor.r);
  const warmScore = anchor.r - anchor.b;
  if (anchor.luma < 72 && coolScore > 5 && anchor.b >= anchor.g) return "coolDark";
  if (anchor.luma < 85 && warmScore > 8) return "warmDark";
  if (anchor.luma < 80) return "neutralDark";
  return "neutral";
}

function selectMaterialRampIds(anchor, colors) {
  const records = colors.map(colorRecordFor);
  const black = records.reduce((best, record) => record.luma < best.luma ? record : best, records[0]);
  const family = materialFamilyForAnchor(anchor);

  if (family === "coolDark") {
    const blueCoolAnchor = anchor.b >= anchor.g - 6;
    const greenCoolAnchor = anchor.g > anchor.b + 8;
    const isBlueDark = (record) => record.luma < 76
      && record.rgb.b >= record.rgb.g + 8
      && record.rgb.g >= record.rgb.r - 4
      && (record.rgb.b - record.rgb.g) <= 62;
    const isBlueNeutralHighlight = (record) => {
      const neutral = Math.abs(record.rgb.r - record.rgb.g) < 24 && Math.abs(record.rgb.g - record.rgb.b) < 34;
      const blueGray = record.rgb.b >= record.rgb.g - 8
        && record.rgb.b >= record.rgb.r + 8
        && record.rgb.g >= record.rgb.r - 8
        && record.rgb.r >= record.rgb.g - 70
        && (record.rgb.b - record.rgb.g) <= 62;
      return record.luma >= 70 && record.luma < 150 && (neutral || blueGray);
    };
    const coolDark = records
      .filter((record) => {
        if (record.luma >= 96 || record.coolScore <= -12) return false;
        if (blueCoolAnchor) return isBlueDark(record);
        if (greenCoolAnchor) return record.rgb.g >= record.rgb.b + 6;
        return true;
      })
      .sort((a, b) => {
        const aTarget = Math.abs(a.luma - 46) - (a.coolScore * 0.01);
        const bTarget = Math.abs(b.luma - 46) - (b.coolScore * 0.01);
        return aTarget - bTarget;
      });
    const coolHighlights = records
      .filter((record) => {
        if (record.luma < 70 || record.luma >= 150 || record.coolScore <= -40) return false;
        if (blueCoolAnchor) return isBlueNeutralHighlight(record);
        if (greenCoolAnchor) return record.rgb.g >= record.rgb.b + 4;
        return true;
      })
      .sort((a, b) => Math.abs(a.luma - 102) - Math.abs(b.luma - 102));
    return {
      family,
      allowedIds: new Set([
        black.colorId,
        ...coolDark.slice(0, 2).map((record) => record.colorId),
        ...coolHighlights.slice(0, 2).map((record) => record.colorId)
      ])
    };
  }

  if (family === "warmDark") {
    const warmDark = records
      .filter((record) => record.luma < 118 && record.warmScore > 10)
      .sort((a, b) => Math.abs(a.luma - 58) - Math.abs(b.luma - 58));
    return {
      family,
      allowedIds: new Set([black.colorId, ...warmDark.slice(0, 4).map((record) => record.colorId)])
    };
  }

  if (family === "neutralDark") {
    const neutralDark = records
      .filter((record) => record.luma < 132 && Math.abs(record.coolScore) < 90)
      .sort((a, b) => Math.abs(a.luma - 76) - Math.abs(b.luma - 76));
    return {
      family,
      allowedIds: new Set([black.colorId, ...neutralDark.slice(0, 3).map((record) => record.colorId)])
    };
  }

  return { family, allowedIds: new Set() };
}

function analyzeMaterialRampContext(data, width, height, colors, mode, analysis = null) {
  const disabled = {
    enabled: false,
    materialFamily: null,
    allowedIds: [],
    skinAllowedIds: [],
    anchor: null,
    cellBiases: new Array(width * height).fill(null),
    materialCells: 0,
    materialRampCells: 0,
    materialRampWeightSum: 0,
    skinCells: 0,
    skinRampCells: 0
  };
  if (mode !== "portrait") return disabled;

  const materialSamples = [];
  let skinCells = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width) + x;
      const index = offset * 4;
      if (data[index + 3] < ALPHA_THRESHOLD) continue;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      if (isSkinLikeCell(r, g, b, x, y, width, height)) {
        skinCells += 1;
      }
      if (!isLowerMaterialCandidate(r, g, b, x, y, width, height)) continue;
      const sample = { offset, x, y, r, g, b, luma: rgbLuma(r, g, b) };
      materialSamples.push(sample);
    }
  }

  const totalCells = width * height;
  if (skinCells < Math.max(4, totalCells * 0.035)) return { ...disabled, skinCells };
  if (materialSamples.length < Math.max(8, totalCells * 0.08)) return { ...disabled, skinCells, materialCells: materialSamples.length };

  const anchor = dominantChromaComponentAnchor(materialSamples, width, height);
  if (!anchor) return { ...disabled, skinCells, materialCells: materialSamples.length };
  anchor.lab = rgbToOklab(anchor.r, anchor.g, anchor.b);
  const ramp = selectMaterialRampIds(anchor, colors);
  if (ramp.allowedIds.size === 0 || ramp.family !== "coolDark") {
    return { ...disabled, skinCells, materialCells: materialSamples.length, anchor };
  }

  const cellBiases = new Array(totalCells).fill(null);
  let materialRampCells = 0;
  let materialRampWeightSum = 0;
  for (const sample of materialSamples) {
    const enriched = sampleChromaDescriptor(sample);
    const weight = materialPriorWeight(enriched, anchor, analysis);
    if (weight <= 0.05) continue;
    cellBiases[sample.offset] = {
      allowedIds: ramp.allowedIds,
      weight,
      penalty: MATERIAL_RAMP_PENALTY
    };
    materialRampCells += 1;
    materialRampWeightSum += weight;
  }

  if (materialRampCells < Math.max(12, totalCells * 0.18)) {
    return {
      ...disabled,
      anchor,
      materialCells: materialSamples.length,
      materialRampCells,
      materialRampWeightSum,
      skinCells
    };
  }

  return {
    enabled: true,
    materialFamily: ramp.family,
    allowedIds: [...ramp.allowedIds],
    skinAllowedIds: [],
    anchor,
    cellBiases,
    materialCells: materialSamples.length,
    materialRampCells,
    materialRampWeightSum,
    skinCells,
    skinRampCells: 0
  };
}

function neighborOffsets(width, index) {
  const x = index % width;
  const offsets = [];
  if (x > 0) offsets.push(index - 1);
  if (x < width - 1) offsets.push(index + 1);
  if (index >= width) offsets.push(index - width);
  if (index < width * width - width) offsets.push(index + width);
  return offsets;
}

function getFourNeighborIndexes(width, height, x, y) {
  const neighbors = [];
  if (x > 0) neighbors.push((y * width) + x - 1);
  if (x < width - 1) neighbors.push((y * width) + x + 1);
  if (y > 0) neighbors.push(((y - 1) * width) + x);
  if (y < height - 1) neighbors.push(((y + 1) * width) + x);
  return neighbors;
}

function getEightNeighborIndexes(width, height, x, y) {
  const neighbors = [];
  for (let ny = -1; ny <= 1; ny += 1) {
    for (let nx = -1; nx <= 1; nx += 1) {
      if (nx === 0 && ny === 0) continue;
      const px = x + nx;
      const py = y + ny;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      neighbors.push((py * width) + px);
    }
  }
  return neighbors;
}

function isSubjectProtected(x, y, width, height) {
  const cx = (width - 1) / 2;
  const cy = (height - 1) * 0.5;
  const rx = Math.max(1, width * 0.24);
  const ry = Math.max(1, height * 0.34);
  const normalized = (((x - cx) / rx) ** 2) + (((y - cy) / ry) ** 2);
  return normalized <= 1;
}

export function cleanupFlatIslands(options) {
  const {
    selectedColorIds,
    optimizedPreviewData,
    width,
    height,
    regionMap,
    colorsById
  } = options;
  const replacements = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x;
      if (regionMap[index] !== "flat") continue;
      const currentId = selectedColorIds[index];
      if (!currentId) continue;

      const counts = new Map();
      for (const neighborIndex of getFourNeighborIndexes(width, height, x, y)) {
        if (regionMap[neighborIndex] === "detail") continue;
        const neighborId = selectedColorIds[neighborIndex];
        if (!neighborId || neighborId === currentId) continue;
        counts.set(neighborId, (counts.get(neighborId) ?? 0) + 1);
      }

      let bestId = null;
      let bestCount = 0;
      for (const [candidateId, count] of counts) {
        if (count > bestCount) {
          bestId = candidateId;
          bestCount = count;
        }
      }
      if (bestId && bestCount >= 3 && colorsById.has(bestId)) {
        replacements.push({ index, colorId: bestId });
      }
    }
  }

  for (const replacement of replacements) {
    const color = colorsById.get(replacement.colorId);
    const rgb = hexToRgb(color.hex);
    selectedColorIds[replacement.index] = replacement.colorId;
    const dataIndex = replacement.index * 4;
    optimizedPreviewData[dataIndex] = rgb.r;
    optimizedPreviewData[dataIndex + 1] = rgb.g;
    optimizedPreviewData[dataIndex + 2] = rgb.b;
    optimizedPreviewData[dataIndex + 3] = 255;
  }

  return replacements.length;
}

export function cleanupTextureIslands(options) {
  const {
    selectedColorIds,
    optimizedPreviewData,
    width,
    height,
    regionMap,
    colorsById
  } = options;
  const replacements = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isSubjectProtected(x, y, width, height)) continue;
      const index = (y * width) + x;
      if (regionMap[index] === "transparent") continue;
      const currentId = selectedColorIds[index];
      if (!currentId) continue;

      const counts = new Map();
      let sameNeighborCount = 0;
      for (const neighborIndex of getEightNeighborIndexes(width, height, x, y)) {
        if (regionMap[neighborIndex] === "transparent") continue;
        const neighborId = selectedColorIds[neighborIndex];
        if (!neighborId) continue;
        if (neighborId === currentId) {
          sameNeighborCount += 1;
          continue;
        }
        counts.set(neighborId, (counts.get(neighborId) ?? 0) + 1);
      }

      let bestId = null;
      let bestCount = 0;
      for (const [candidateId, count] of counts) {
        if (count > bestCount) {
          bestId = candidateId;
          bestCount = count;
        }
      }

      const replaceIsolated = sameNeighborCount === 0 && bestCount >= 5;
      if (replaceIsolated && bestId && colorsById.has(bestId)) {
        replacements.push({ index, colorId: bestId });
      }
    }
  }

  for (const replacement of replacements) {
    const color = colorsById.get(replacement.colorId);
    const rgb = hexToRgb(color.hex);
    selectedColorIds[replacement.index] = replacement.colorId;
    const dataIndex = replacement.index * 4;
    optimizedPreviewData[dataIndex] = rgb.r;
    optimizedPreviewData[dataIndex + 1] = rgb.g;
    optimizedPreviewData[dataIndex + 2] = rgb.b;
    optimizedPreviewData[dataIndex + 3] = 255;
  }

  return replacements.length;
}

function buildColorCounts(selectedColorIds, colorsById, mode) {
  const counts = {};
  for (const colorId of selectedColorIds) {
    if (!colorId) continue;
    if (mode === "parts") {
      if (counts[colorId]) {
        counts[colorId].count += 1;
      } else {
        counts[colorId] = { ...colorsById.get(colorId), count: 1 };
      }
    } else {
      counts[colorId] = (counts[colorId] ?? 0) + 1;
    }
  }
  return counts;
}

function countIsolatedBricks(selectedColorIds, regionMap, width, height) {
  let isolated = 0;
  let colored = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x;
      const currentId = selectedColorIds[index];
      if (!currentId || regionMap[index] === "transparent") continue;
      colored += 1;
      const sameNeighbor = getFourNeighborIndexes(width, height, x, y)
        .some((neighborIndex) => selectedColorIds[neighborIndex] === currentId);
      if (!sameNeighbor) isolated += 1;
    }
  }
  return { isolated, colored, ratio: colored > 0 ? isolated / colored : 0 };
}

function countConnectedComponents(selectedColorIds, width, height) {
  const seen = new Uint8Array(width * height);
  let components = 0;
  for (let index = 0; index < selectedColorIds.length; index += 1) {
    if (seen[index] || !selectedColorIds[index]) continue;
    components += 1;
    const colorId = selectedColorIds[index];
    const stack = [index];
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop();
      const x = current % width;
      const y = Math.floor(current / width);
      for (const neighborIndex of getFourNeighborIndexes(width, height, x, y)) {
        if (seen[neighborIndex] || selectedColorIds[neighborIndex] !== colorId) continue;
        seen[neighborIndex] = 1;
        stack.push(neighborIndex);
      }
    }
  }
  return components;
}

function computeAdjacentColorDelta(data, width, height) {
  let total = 0;
  let count = 0;
  const add = (a, b) => {
    const ai = a * 4;
    const bi = b * 4;
    if (data[ai + 3] < ALPHA_THRESHOLD || data[bi + 3] < ALPHA_THRESHOLD) return;
    const dr = data[ai] - data[bi];
    const dg = data[ai + 1] - data[bi + 1];
    const db = data[ai + 2] - data[bi + 2];
    total += Math.sqrt((dr * dr) + (dg * dg) + (db * db));
    count += 1;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x;
      if (x < width - 1) add(index, index + 1);
      if (y < height - 1) add(index, index + width);
    }
  }
  return count > 0 ? total / count : 0;
}

function computeEdgePreservation(sourceData, outputData, width, height) {
  let sourceTotal = 0;
  let outputTotal = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (sourceData[index + 3] < ALPHA_THRESHOLD || outputData[index + 3] < ALPHA_THRESHOLD) continue;
      sourceTotal += getEdgeMagnitude(sourceData, width, height, x, y);
      outputTotal += getEdgeMagnitude(outputData, width, height, x, y);
      count += 1;
    }
  }
  if (!count || sourceTotal <= 0) return 1;
  return Math.max(0, Math.min(1.5, outputTotal / sourceTotal));
}

function diffuseFactory(smoothed, width, height, errR, errG, errB, adaptiveStrength) {
  return (nextX, nextY, weight) => {
    if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return;
    const index = (nextY * width + nextX) * 4;
    if (smoothed[index + 3] < ALPHA_THRESHOLD) return;
    smoothed[index] = clampByte(smoothed[index] + (errR * weight * adaptiveStrength));
    smoothed[index + 1] = clampByte(smoothed[index + 1] + (errG * weight * adaptiveStrength));
    smoothed[index + 2] = clampByte(smoothed[index + 2] + (errB * weight * adaptiveStrength));
  };
}

export function quantize(opts) {
  const {
    imageData,
    cols: width,
    rows: height,
    colors,
    ditheringMode = "subtle",
    materialMode = "square_1x1",
    boardCompensation = { enabled: false, backgroundHex: "#F3EFE7" },
    lightPieceCompensation = { enabled: false, thresholdLuma: 220, darkenRatio: 0.08 },
    colorCountMode = "counts",
    materialRampMode = "portrait",
    spatialStabilization = {}
  } = opts;
  const tuned = {
    darkCpBoost: 1.0,
    darkLuminanceThreshold: 0.25,
    paletteCpExponent: 4.0,
    pruningErrorBudget: 0.08,
    lightnessWeight: LIGHTNESS_WEIGHT,
    ...(opts.tuning || {})
  };
  const blockAnchorConfig = {
    enabled: false,
    blockSize: 4,
    weight: 0.40,
    ...(spatialStabilization.blockAnchor && typeof spatialStabilization.blockAnchor === "object"
      ? spatialStabilization.blockAnchor
      : {})
  };
  if (spatialStabilization.blockAnchor === true) blockAnchorConfig.enabled = true;
  const despeckleConfig = {
    enabled: true,
    ...(spatialStabilization.despeckle && typeof spatialStabilization.despeckle === "object"
      ? spatialStabilization.despeckle
      : {})
  };
  if (spatialStabilization.despeckle === true) despeckleConfig.enabled = true;
  const localManifoldConfig = normalizeLocalManifoldConfig(spatialStabilization);

  const data = new Uint8ClampedArray(imageData);
  const { lab: paletteLab, colorsById } = buildPalette(colors);

  sharpen(data, width, height);
  toneMap(data);

  const smoothed = bilateralFilter(data, width, height, {
    radius: 3,
    sigmaSpace: 2.5,
    sigmaColor: 20.0
  });
  const analysis = analyzeRegionMap(smoothed, width, height);
  const materialRamp = analyzeMaterialRampContext(smoothed, width, height, colors, materialRampMode, analysis);
  const manifoldSourceData = new Uint8ClampedArray(smoothed);

  const BLOCK_SIZE = Math.max(1, Math.floor(blockAnchorConfig.blockSize));
  const blockCols = Math.ceil(width / BLOCK_SIZE);
  const blockRows = Math.ceil(height / BLOCK_SIZE);
  const blockColors = new Array(blockCols * blockRows).fill(null);
  if (blockAnchorConfig.enabled) {
    for (let by = 0; by < blockRows; by += 1) {
      for (let bx = 0; bx < blockCols; bx += 1) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;
        for (let dy = 0; dy < BLOCK_SIZE; dy += 1) {
          for (let dx = 0; dx < BLOCK_SIZE; dx += 1) {
            const px = bx * BLOCK_SIZE + dx;
            const py = by * BLOCK_SIZE + dy;
            if (px >= width || py >= height) continue;
            const idx = (py * width + px) * 4;
            if (smoothed[idx + 3] < ALPHA_THRESHOLD) continue;
            sumR += smoothed[idx];
            sumG += smoothed[idx + 1];
            sumB += smoothed[idx + 2];
            count += 1;
          }
        }
        if (count === 0) continue;
        const avgR = sumR / count;
        const avgG = sumG / count;
        const avgB = sumB / count;
        const avgLab = rgbToOklab(avgR, avgG, avgB);
        let bestJ = 0;
        let bestD = Infinity;
        for (let j = 0; j < colors.length; j += 1) {
          const off = j * 3;
          const dL = avgLab.L - paletteLab[off];
          const dA = avgLab.a - paletteLab[off + 1];
          const dB = avgLab.b - paletteLab[off + 2];
          const d = tuned.lightnessWeight * dL * dL + dA * dA + dB * dB;
          if (d < bestD) { bestD = d; bestJ = j; }
        }
        blockColors[by * blockCols + bx] = {
          colorId: colorIdFor(colors[bestJ]),
          lab: [paletteLab[bestJ * 3], paletteLab[bestJ * 3 + 1], paletteLab[bestJ * 3 + 2]]
        };
      }
    }
  }
  const BLOCK_ANCHOR_WEIGHT = blockAnchorConfig.enabled ? blockAnchorConfig.weight : 0;
  const paletteSizeRatio = colors.length / 42;
  const PALETTE_SIZE_SCALE = Math.min(4.0, Math.max(1.0, Math.pow(paletteSizeRatio, tuned.paletteCpExponent)));
  const originalData = new Uint8ClampedArray(data);
  const optimizedPreviewData = new Uint8ClampedArray(data.length);
  const errorMap = new Uint8ClampedArray(width * height);
  const selectedColorIds = new Array(width * height).fill(null);
  const quantizationErrorMap = new Float32Array(width * height);
  let totalError = 0;
  let coloredPixels = 0;
  let substitutionCount = 0;
  let localManifoldCells = 0;

  for (let y = 0; y < height; y += 1) {
    const scanLeftToRight = y % 2 === 0;
    const xStart = scanLeftToRight ? 0 : width - 1;
    const xEnd = scanLeftToRight ? width : -1;
    const xStep = scanLeftToRight ? 1 : -1;
    for (let x = xStart; x !== xEnd; x += xStep) {
      const offset = (y * width) + x;
      const index = offset * 4;
      if (smoothed[index + 3] < ALPHA_THRESHOLD) {
        smoothed[index + 3] = 0;
        optimizedPreviewData[index + 3] = 0;
        errorMap[offset] = 0;
        continue;
      }

      const region = analysis.regionMap[offset];
      const policy = getRegionalQuantizePolicy(region, ditheringMode);
      const previousColorId = scanLeftToRight
        ? (x > 0 ? selectedColorIds[offset - 1] : null)
        : (x < width - 1 ? selectedColorIds[offset + 1] : null);
      const topColorId = y > 0 ? selectedColorIds[offset - width] : null;
      const sR = smoothed[index];
      const sG = smoothed[index + 1];
      const sB = smoothed[index + 2];
      const bx = Math.floor(x / BLOCK_SIZE);
      const by = Math.floor(y / BLOCK_SIZE);
      const blockIdx = by * blockCols + bx;
      const blockAnchor = blockColors[blockIdx];
      const localManifoldBias = getLocalManifoldBias({
        data: manifoldSourceData,
        width,
        height,
        x,
        y,
        analysis,
        config: localManifoldConfig
      });
      if (localManifoldBias) localManifoldCells += 1;
      const { closestColor, distance } = getClosestColor(sR, sG, sB, {
        colors,
        paletteLab,
        previousColorId,
        topColorId,
        materialMode,
        penaltyMultiplier: policy.penaltyMultiplier * PALETTE_SIZE_SCALE,
        rampBias: materialRamp.cellBiases[offset],
        blockAnchorLab: blockAnchor?.lab ?? null,
        blockAnchorWeight: blockAnchor ? BLOCK_ANCHOR_WEIGHT : 0,
        localManifoldBias,
        darkCpBoost: tuned.darkCpBoost,
        darkLuminanceThreshold: tuned.darkLuminanceThreshold,
        lightnessWeight: tuned.lightnessWeight
      });
      const targetRGB = hexToRgb(closestColor.hex);
      const selectedId = colorIdFor(closestColor);

      selectedColorIds[offset] = selectedId;
      quantizationErrorMap[offset] = distance;
      totalError += distance;
      coloredPixels += 1;
      if (distance > 0.045) substitutionCount += 1;
      errorMap[offset] = Math.max(0, Math.min(255, Math.round((distance / 0.22) * 255)));

      smoothed[index] = targetRGB.r;
      smoothed[index + 1] = targetRGB.g;
      smoothed[index + 2] = targetRGB.b;
      smoothed[index + 3] = 255;
      optimizedPreviewData[index] = targetRGB.r;
      optimizedPreviewData[index + 1] = targetRGB.g;
      optimizedPreviewData[index + 2] = targetRGB.b;
      optimizedPreviewData[index + 3] = 255;

      if (policy.strength > 0) {
        const errR = Math.max(-60, Math.min(60, sR - targetRGB.r));
        const errG = Math.max(-60, Math.min(60, sG - targetRGB.g));
        const errB = Math.max(-60, Math.min(60, sB - targetRGB.b));
        const errorFactor = Math.min(1, distance / 0.12);
        const localSpread = analysis.localSpreadMap[offset];
        const edgeFactor = Math.min(1, localSpread / 35);
        const regionalFactor = region === "flat"
          ? policy.ditherScale * Math.min(errorFactor, edgeFactor)
          : Math.min(1, policy.ditherFloor + (policy.ditherScale * Math.max(errorFactor, edgeFactor * policy.edgeProtection)));
        const adaptiveStrength = policy.strength * regionalFactor;
        const diffuse = diffuseFactory(smoothed, width, height, errR, errG, errB, adaptiveStrength);

        if (ditheringMode === "atkinson") {
          const f = 1 / 8;
          if (scanLeftToRight) {
            diffuse(x + 1, y, f); diffuse(x + 2, y, f);
            diffuse(x - 1, y + 1, f); diffuse(x, y + 1, f); diffuse(x + 1, y + 1, f);
            diffuse(x, y + 2, f);
          } else {
            diffuse(x - 1, y, f); diffuse(x - 2, y, f);
            diffuse(x + 1, y + 1, f); diffuse(x, y + 1, f); diffuse(x - 1, y + 1, f);
            diffuse(x, y + 2, f);
          }
        } else if (scanLeftToRight) {
          diffuse(x + 1, y, 7 / 16);
          diffuse(x - 1, y + 1, 3 / 16);
          diffuse(x, y + 1, 5 / 16);
          diffuse(x + 1, y + 1, 1 / 16);
        } else {
          diffuse(x - 1, y, 7 / 16);
          diffuse(x + 1, y + 1, 3 / 16);
          diffuse(x, y + 1, 5 / 16);
          diffuse(x - 1, y + 1, 1 / 16);
        }
      }
    }
  }

  const cleanupChanges = cleanupFlatIslands({
    selectedColorIds,
    optimizedPreviewData,
    width,
    height,
    regionMap: analysis.regionMap,
    colorsById
  });
  const textureCleanupChanges = cleanupTextureIslands({
    selectedColorIds,
    optimizedPreviewData,
    width,
    height,
    regionMap: analysis.regionMap,
    colorsById
  });

  let despeckleChanges = 0;
  if (despeckleConfig.enabled) {
    for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width) + x;
        if (analysis.regionMap[index] === "transparent") continue;
        if (pass > 0 && !(analysis.regionMap[index] === "flat" || (analysis.localSpreadMap?.[index] ?? 0) < 3)) continue;
        const currentId = selectedColorIds[index];
        if (!currentId) continue;
        const isFlatRegion = analysis.regionMap[index] === "flat" ||
          (analysis.localSpreadMap?.[index] ?? 0) < 3;
        const neighborCounts = new Map();
        const neighborChromas = [];
        let sameCount = 0;
        let totalNeighbors = 0;
        for (let ny = -2; ny <= 2; ny += 1) {
          for (let nx = -2; nx <= 2; nx += 1) {
            if (nx === 0 && ny === 0) continue;
            const px = x + nx;
            const py = y + ny;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            const ni = py * width + px;
            const nId = selectedColorIds[ni];
            if (!nId) continue;
            totalNeighbors += 1;
            const nLab = rgbToOklab(optimizedPreviewData[ni * 4], optimizedPreviewData[ni * 4 + 1], optimizedPreviewData[ni * 4 + 2]);
            neighborChromas.push(Math.sqrt(nLab.a * nLab.a + nLab.b * nLab.b));
            if (nId === currentId) {
              sameCount += 1;
              continue;
            }
            neighborCounts.set(nId, (neighborCounts.get(nId) ?? 0) + 1);
          }
        }
        if (totalNeighbors < 10) continue;
        const sameThreshold = isFlatRegion ? 3 : 5;
        if (sameCount >= sameThreshold) continue;
        let bestId = null;
        let bestCount = 0;
        for (const [candidateId, count] of neighborCounts) {
          if (count > bestCount) {
            bestId = candidateId;
            bestCount = count;
          }
        }
        const replaceThreshold = isFlatRegion ? 5 : 8;
        if (bestId && bestCount >= replaceThreshold && colorsById.has(bestId)) {
          const currentLab = rgbToOklab(
            optimizedPreviewData[index * 4],
            optimizedPreviewData[index * 4 + 1],
            optimizedPreviewData[index * 4 + 2]
          );
          const Ccur = Math.sqrt(currentLab.a * currentLab.a + currentLab.b * currentLab.b);
          neighborChromas.sort((a, b) => a - b);
          const Cmed = neighborChromas[Math.floor(neighborChromas.length / 2)];
          if (!isFlatRegion && Ccur <= Cmed + 0.03) continue;
          const replacement = colorsById.get(bestId);
          const replRgb = hexToRgb(replacement.hex);
          const replLab = rgbToOklab(replRgb.r, replRgb.g, replRgb.b);
          const Crepl = Math.sqrt(replLab.a * replLab.a + replLab.b * replLab.b);
          if (Ccur <= Crepl + 0.03) continue;
          const okDist = Math.sqrt(
            (tuned.lightnessWeight * (currentLab.L - replLab.L) ** 2) +
            (currentLab.a - replLab.a) ** 2 +
            (currentLab.b - replLab.b) ** 2
          );
          if (okDist < 0.15) {
            selectedColorIds[index] = bestId;
            optimizedPreviewData[index * 4] = replRgb.r;
            optimizedPreviewData[index * 4 + 1] = replRgb.g;
            optimizedPreviewData[index * 4 + 2] = replRgb.b;
            despeckleChanges += 1;
          }
        }
      }
    }
    }
  }

  let regionSmoothChanges = 0;
  for (let rPass = 0; rPass < 2; rPass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width) + x;
        const currentId = selectedColorIds[index];
        if (!currentId) continue;
        const regionType = analysis.regionMap[index];
        if (regionType === "detail") continue;
        const isFlat = regionType === "flat";
        const radius = isFlat ? 2 : 1;
        if (!isFlat && analysis.edgeMap[index] > 16) continue;

        const neighborCounts = new Map();
        let totalN = 0;
        for (let ny = -radius; ny <= radius; ny += 1) {
          for (let nx = -radius; nx <= radius; nx += 1) {
            if (nx === 0 && ny === 0) continue;
            const px = x + nx;
            const py = y + ny;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            const ni = py * width + px;
            const nId = selectedColorIds[ni];
            if (!nId) continue;
            totalN += 1;
            neighborCounts.set(nId, (neighborCounts.get(nId) ?? 0) + 1);
          }
        }
        const minNeighbors = isFlat ? 8 : 3;
        if (totalN < minNeighbors) continue;

        let bestId = null;
        let bestCount = 0;
        for (const [candidateId, count] of neighborCounts) {
          if (count > bestCount) { bestId = candidateId; bestCount = count; }
        }

        const replaceThreshold = isFlat ? 5 : 3;
        if (bestId && bestId !== currentId && bestCount >= replaceThreshold && colorsById.has(bestId)) {
          const currentLab = rgbToOklab(
            optimizedPreviewData[index * 4],
            optimizedPreviewData[index * 4 + 1],
            optimizedPreviewData[index * 4 + 2]
          );
          const replacement = colorsById.get(bestId);
          const replRgb = hexToRgb(replacement.hex);
          const replLab = rgbToOklab(replRgb.r, replRgb.g, replRgb.b);
          const okDist = Math.sqrt(
            (tuned.lightnessWeight * (currentLab.L - replLab.L) ** 2) +
            (currentLab.a - replLab.a) ** 2 +
            (currentLab.b - replLab.b) ** 2
          );
          const okDistLimit = 0.12;
          if (okDist < okDistLimit) {
            selectedColorIds[index] = bestId;
            optimizedPreviewData[index * 4] = replRgb.r;
            optimizedPreviewData[index * 4 + 1] = replRgb.g;
            optimizedPreviewData[index * 4 + 2] = replRgb.b;
            regionSmoothChanges += 1;
          }
        }
      }
    }
  }

  let colorPruneChanges = 0;
  const colorFreq = new Map();
  for (let i = 0; i < selectedColorIds.length; i += 1) {
    const cid = selectedColorIds[i];
    if (!cid) continue;
    colorFreq.set(cid, (colorFreq.get(cid) ?? 0) + 1);
  }

  if (tuned.pruningErrorBudget > 0 && colorFreq.size > 1 && coloredPixels > 0) {
    const usedColorIds = [...colorFreq.keys()];
    const labMap = new Map();
    for (const cid of usedColorIds) {
      const c = colorsById.get(cid);
      if (!c) continue;
      const rgb = hexToRgb(c.hex);
      labMap.set(cid, rgbToOklab(rgb.r, rgb.g, rgb.b));
    }
    const candidates = [];
    for (const cid of usedColorIds) {
      const labA = labMap.get(cid);
      if (!labA) continue;
      let bestOtherId = null;
      let bestOkDist = Infinity;
      for (const oid of usedColorIds) {
        if (oid === cid) continue;
        const labB = labMap.get(oid);
        if (!labB) continue;
        const d = Math.sqrt(
          tuned.lightnessWeight * (labA.L - labB.L) ** 2 +
          (labA.a - labB.a) ** 2 +
          (labA.b - labB.b) ** 2
        );
        if (d < bestOkDist) { bestOkDist = d; bestOtherId = oid; }
      }
      if (bestOtherId === null) continue;
      const freq = colorFreq.get(cid);
      candidates.push({ cid, nearestId: bestOtherId, okDist: bestOkDist, cost: freq * bestOkDist });
    }
    candidates.sort((a, b) => a.cost - b.cost);
    const totalErrorBudget = totalError * tuned.pruningErrorBudget;
    let cumulative = 0;
    const pruneMap = new Map();
    for (const c of candidates) {
      if (cumulative + c.cost > totalErrorBudget) break;
      pruneMap.set(c.cid, c.nearestId);
      cumulative += c.cost;
    }
    function resolveTarget(cid) {
      let cur = cid;
      const visited = new Set();
      while (pruneMap.has(cur) && !visited.has(cur)) {
        visited.add(cur);
        const next = pruneMap.get(cur);
        if (next === cur) break;
        cur = next;
      }
      return cur;
    }
    if (pruneMap.size > 0) {
      for (let i = 0; i < selectedColorIds.length; i += 1) {
        const cid = selectedColorIds[i];
        if (!cid) continue;
        if (!pruneMap.has(cid)) continue;
        const target = resolveTarget(cid);
        if (target === cid || !colorsById.has(target)) continue;
        const repl = colorsById.get(target);
        const rr = hexToRgb(repl.hex);
        selectedColorIds[i] = target;
        optimizedPreviewData[i * 4] = rr.r;
        optimizedPreviewData[i * 4 + 1] = rr.g;
        optimizedPreviewData[i * 4 + 2] = rr.b;
        colorPruneChanges += 1;
      }
    }
  }

  const baseLayerData = new Uint8ClampedArray(optimizedPreviewData);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (baseLayerData[index + 3] < ALPHA_THRESHOLD) continue;
      const localSpread = getLocalSpread(optimizedPreviewData, width, height, x, y, 1);
      let compensated = applyBoardCompensationToRgb(
        { r: baseLayerData[index], g: baseLayerData[index + 1], b: baseLayerData[index + 2] },
        boardCompensation
      );
      compensated = applyLightPieceCompensation(
        compensated,
        lightPieceCompensation,
        localSpread,
        boardCompensation.enabled ? hexToRgb(boardCompensation.backgroundHex) : null
      );
      baseLayerData[index] = compensated.r;
      baseLayerData[index + 1] = compensated.g;
      baseLayerData[index + 2] = compensated.b;
    }
  }

  const isolated = countIsolatedBricks(selectedColorIds, analysis.regionMap, width, height);
  const reliefMask = buildReliefMask(baseLayerData, width, height);
  return {
    resultData: new Uint8ClampedArray(optimizedPreviewData),
    optimizedPreviewData,
    baseLayerData,
    reliefMask,
    colorCounts: buildColorCounts(selectedColorIds, colorsById, colorCountMode),
    errorMap,
    regionMap: analysis.regionMap,
    selectedColorIds,
    stats: {
      coloredPixels,
      substitutionCount,
      avgError: coloredPixels > 0 ? totalError / coloredPixels : 0,
      regionCounts: analysis.regionCounts,
      cleanupChanges,
      textureCleanupChanges,
      despeckleChanges,
      regionSmoothChanges,
      colorPruneChanges,
      blockAnchor: {
        enabled: blockAnchorConfig.enabled,
        blockSize: BLOCK_SIZE,
        weight: BLOCK_ANCHOR_WEIGHT
      },
      despeckle: {
        enabled: despeckleConfig.enabled,
        changes: despeckleChanges
      },
      localManifold: {
        enabled: localManifoldConfig.enabled,
        cells: localManifoldCells,
        radius: localManifoldConfig.radius,
        weight: localManifoldConfig.weight
      },
      isolatedBricks: isolated.isolated,
      isolatedBrickRatio: isolated.ratio,
      connectedComponents: countConnectedComponents(selectedColorIds, width, height),
      adjacentColorDelta: computeAdjacentColorDelta(optimizedPreviewData, width, height),
      edgePreservation: computeEdgePreservation(originalData, optimizedPreviewData, width, height),
      materialRamp: {
        enabled: materialRamp.enabled,
        materialFamily: materialRamp.materialFamily,
        allowedIds: materialRamp.allowedIds,
        skinAllowedIds: materialRamp.skinAllowedIds,
        materialCells: materialRamp.materialCells,
        materialRampCells: materialRamp.materialRampCells,
        materialRampWeightSum: materialRamp.materialRampWeightSum,
        skinCells: materialRamp.skinCells,
        skinRampCells: materialRamp.skinRampCells,
        anchor: materialRamp.anchor ? {
          r: Math.round(materialRamp.anchor.r),
          g: Math.round(materialRamp.anchor.g),
          b: Math.round(materialRamp.anchor.b),
          luma: Math.round(materialRamp.anchor.luma)
        } : null
      }
    }
  };
}

export function quantizeForWorker(options) {
  return quantize({ ...options, colorCountMode: "parts" });
}
