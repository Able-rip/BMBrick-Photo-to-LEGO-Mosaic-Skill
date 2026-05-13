import { buildReliefMask } from "./fidelity-pipeline.mjs";
import {
  buildPieceRenderPalette,
  getPieceRenderGeometry
} from "./render-style.mjs";

export const CASE_PREVIEW_BOARD_HEX = "#F3EFE7";

export function getBrowserPreviewQuantizeOptions() {
  return {
    boardCompensation: {
      enabled: true,
      backgroundHex: CASE_PREVIEW_BOARD_HEX
    },
    lightPieceCompensation: {
      enabled: true,
      thresholdLuma: 220,
      darkenRatio: 0.03
    }
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getCaseRenderResolution(cols, rows) {
  const maxDimension = Math.max(cols, rows);
  return clamp(Math.round(1600 / maxDimension), 6, 18);
}

function channelToHex(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

function rgbToHex(r, g, b) {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function colorToHex(color) {
  if (typeof color === "string") {
    if (color.startsWith("#")) {
      return color;
    }
    const channels = color.match(/\d+/g)?.map(Number) ?? [];
    return rgbToHex(channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0);
  }
  return rgbToHex(color.r ?? 0, color.g ?? 0, color.b ?? 0);
}

function renderBoardBackground(targetCanvas, cols, rows, studSize, materialMode) {
  targetCanvas.width = cols * studSize;
  targetCanvas.height = rows * studSize;
  const context = targetCanvas.getContext("2d");
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

  const isRoundTile = materialMode === "round_1x1";
  context.fillStyle = isRoundTile ? "rgb(42, 39, 35)" : "rgb(48, 44, 39)";
  context.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

  if (!isRoundTile) {
    const seamShadowWidth = Math.max(0.5, studSize * 0.01);
    context.fillStyle = "rgba(0, 0, 0, 0.24)";
    for (let x = studSize - (seamShadowWidth / 2); x < targetCanvas.width; x += studSize) {
      context.fillRect(x, 0, seamShadowWidth, targetCanvas.height);
    }
    for (let y = studSize - (seamShadowWidth / 2); y < targetCanvas.height; y += studSize) {
      context.fillRect(0, y, targetCanvas.width, seamShadowWidth);
    }
  }
}

function renderReliefLayer(targetCanvas, cols, rows, studSize, reliefMask) {
  targetCanvas.width = cols * studSize;
  targetCanvas.height = rows * studSize;
  const context = targetCanvas.getContext("2d");
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const maskValue = reliefMask?.[(y * cols) + x] ?? 0;
      if (maskValue < 20) {
        continue;
      }
      const alpha = Math.min(0.07, maskValue / 5000);
      const px = x * studSize;
      const py = y * studSize;
      context.fillStyle = `rgba(0, 0, 0, ${alpha})`;
      context.fillRect(px + studSize * 0.04, py + studSize * 0.06, studSize * 0.92, studSize * 0.92);
    }
  }
}

function renderBrickPreview(targetCanvas, options) {
  const {
    createCanvas,
    cols,
    rows,
    data,
    studSize,
    background,
    renderMode,
    materialMode
  } = options;
  const minLength = cols * rows * 4;
  if (!data || data.length < minLength) {
    return;
  }

  targetCanvas.width = cols * studSize;
  targetCanvas.height = rows * studSize;

  const context = targetCanvas.getContext("2d");
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  if (background !== "transparent") {
    context.fillStyle = background;
    context.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  }

  const textureCache = new Map();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const index = (y * cols + x) * 4;
      const alpha = data[index + 3];
      if (alpha < 16) {
        continue;
      }

      const color = `rgb(${data[index]}, ${data[index + 1]}, ${data[index + 2]})`;
      const px = x * studSize;
      const py = y * studSize;

      const texture = getCachedBrickTexture({
        createCanvas,
        textureCache,
        color,
        studSize,
        materialMode,
        renderMode
      });
      context.drawImage(texture, px, py);
    }
  }
}

function getCachedBrickTexture(options) {
  const {
    createCanvas,
    textureCache,
    color,
    studSize,
    materialMode,
    renderMode
  } = options;
  const key = `${color}-${studSize}-${materialMode}-${renderMode}`;
  if (textureCache.has(key)) {
    return textureCache.get(key);
  }

  const canvas = createCanvas(studSize, studSize);
  const context = canvas.getContext("2d");

  if (materialMode === "round_1x1") {
    renderRoundCell(context, 0, 0, studSize, color, renderMode);
  } else {
    renderSquareCell(context, 0, 0, studSize, color, renderMode);
  }

  textureCache.set(key, canvas);
  return canvas;
}

function renderRoundCell(context, px, py, studSize, color, renderMode) {
  const palette = buildPieceRenderPalette(colorToHex(color), { materialMode: "round_1x1", renderMode });
  const geometry = getPieceRenderGeometry(studSize, { materialMode: "round_1x1", renderMode });
  const cx = px + studSize / 2;
  const cy = py + studSize / 2;
  const radius = geometry.radius;

  if (renderMode === "flat" || renderMode === "preview-face" || renderMode === "preview") {
    context.fillStyle = palette.face;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();

    if (renderMode === "preview-face" || renderMode === "preview") {
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.lineWidth = geometry.outlineWidth;
      context.strokeStyle = palette.border;
      context.stroke();
    }
  }

  if (renderMode === "flat") {
    return;
  }

  if (renderMode === "preview-relief") {
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.lineWidth = geometry.outlineWidth;
    context.strokeStyle = palette.border;
    context.stroke();
    return;
  }

  if (renderMode === "preview-studs") {
    return;
  }
}

function renderSquareCell(context, px, py, studSize, color, renderMode) {
  const hex = colorToHex(color);
  const palette = buildPieceRenderPalette(hex, { materialMode: "square_1x1", renderMode });
  const geometry = getPieceRenderGeometry(studSize, { materialMode: "square_1x1", renderMode });
  const inset = geometry.faceInset ?? geometry.inset ?? 0;
  const size = studSize - inset * 2;
  const studRadius = geometry.studRadius;

  if (renderMode === "flat" || renderMode === "preview-face") {
    if (renderMode === "preview-face") {
      const gradient = context.createLinearGradient(px, py, px + studSize, py + studSize);
      gradient.addColorStop(0, palette.highlight);
      gradient.addColorStop(1, palette.shadow);
      context.fillStyle = gradient;
    } else {
      context.fillStyle = palette.face;
    }
    context.fillRect(px + inset, py + inset, size, size);

    if (renderMode === "preview-face") {
      context.strokeStyle = "rgba(255, 255, 255, 0.3)";
      context.lineWidth = 0.5;
      context.strokeRect(px + inset, py + inset, size, size);
    }
  }

  if (renderMode === "preview-relief") {
    context.lineWidth = geometry.outlineWidth;
    context.strokeStyle = palette.border;
    context.strokeRect(px + inset, py + inset, size, size);
  }

  if (renderMode === "preview-studs" || renderMode === "preview") {
    const cx = px + (studSize / 2);
    const cy = py + (studSize / 2);

    context.beginPath();
    context.arc(cx + 1, cy + 1, studRadius, 0, Math.PI * 2);
    context.fillStyle = "rgba(0, 0, 0, 0.35)";
    context.fill();

    context.beginPath();
    context.arc(cx, cy, studRadius, 0, Math.PI * 2);
    const gradient = context.createLinearGradient(
      cx - studRadius,
      cy - studRadius,
      cx + studRadius,
      cy + studRadius
    );
    gradient.addColorStop(0, palette.highlight);
    gradient.addColorStop(1, palette.shadow);
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    context.arc(cx, cy, studRadius * 0.65, 0, Math.PI * 2);
    context.strokeStyle = "rgba(255, 255, 255, 0.15)";
    context.lineWidth = 0.5;
    context.stroke();
  }
}

export function renderCaseMosaicPreview(options) {
  const {
    createCanvas,
    cols,
    rows,
    optimizedPreviewData,
    baseLayerData,
    reliefMask,
    materialMode = "square_1x1",
    studSize = getCaseRenderResolution(cols, rows)
  } = options;
  const minColorLength = cols * rows * 4;
  if (!optimizedPreviewData || optimizedPreviewData.length < minColorLength) {
    throw new Error("renderCaseMosaicPreview requires optimizedPreviewData for the full grid");
  }

  const safeBaseLayerData = baseLayerData && baseLayerData.length >= minColorLength
    ? baseLayerData
    : optimizedPreviewData;
  const safeReliefMask = reliefMask && reliefMask.length >= cols * rows
    ? reliefMask
    : buildReliefMask(safeBaseLayerData, cols, rows);

  const width = cols * studSize;
  const height = rows * studSize;
  const outputCanvas = createCanvas(width, height);
  const outputContext = outputCanvas.getContext("2d");
  const backgroundCanvas = createCanvas(width, height);
  const faceCanvas = createCanvas(width, height);
  const reliefCanvas = createCanvas(width, height);
  const studsCanvas = createCanvas(width, height);

  renderBoardBackground(backgroundCanvas, cols, rows, studSize, materialMode);
  renderBrickPreview(faceCanvas, {
    createCanvas,
    cols,
    rows,
    data: optimizedPreviewData,
    studSize,
    background: "transparent",
    renderMode: "preview-face",
    materialMode
  });
  renderReliefLayer(reliefCanvas, cols, rows, studSize, safeReliefMask);
  renderBrickPreview(studsCanvas, {
    createCanvas,
    cols,
    rows,
    data: optimizedPreviewData,
    studSize,
    background: "transparent",
    renderMode: "preview-studs",
    materialMode
  });

  outputContext.drawImage(backgroundCanvas, 0, 0);
  outputContext.drawImage(faceCanvas, 0, 0);
  outputContext.drawImage(reliefCanvas, 0, 0);
  outputContext.drawImage(studsCanvas, 0, 0);

  return outputCanvas;
}
