import { hexToRgb } from "./color-science.mjs";

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mixRgb(left, right, ratio) {
  return {
    r: clampChannel((left.r * (1 - ratio)) + (right.r * ratio)),
    g: clampChannel((left.g * (1 - ratio)) + (right.g * ratio)),
    b: clampChannel((left.b * (1 - ratio)) + (right.b * ratio))
  };
}

function rgbToCss(rgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function getPieceRenderGeometry(studSize, options = {}) {
  const {
    materialMode = "square_1x1",
    renderMode = "preview"
  } = options;

  if (materialMode === "square_1x1") {
    // Adjacent bricks combine to a 1% visible seam.
    const visibleSeamRatio = 0.01;
    const groutGap = studSize * (visibleSeamRatio / 2);
    return {
      groutInset: groutGap,
      faceInset: groutGap,
      cornerRadius: Math.max(1, studSize * 0.03),
      // Slightly smaller than measured 3024 for a cleaner dense preview.
      studRadius: renderMode === "flat" ? studSize * 0.26 : studSize * 0.28,
      outlineWidth: Math.max(0.5, studSize * 0.025),
      studOutlineWidth: Math.max(0.5, studSize * 0.02)
    };
  }

  return {
    faceInset: studSize * 0.01,
    radius: studSize * 0.49,
    studRadius: 0,
    outlineWidth: Math.max(0.6, studSize * 0.035),
    studOutlineWidth: 0
  };
}

export function buildPieceRenderPalette(hex, options = {}) {
  const {
    materialMode = "square_1x1",
    renderMode = "preview",
    compensation = null
  } = options;
  const base = hexToRgb(hex);
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 18, g: 18, b: 18 };

  // V6: border is subtle — just enough to separate from grout area
  const borderRatio = renderMode === "flat" ? 0.02 : materialMode === "square_1x1" ? 0.06 : 0.05;
  const isRoundTile = materialMode === "round_1x1";
  const studRatio = renderMode === "flat" ? 0.01 : isRoundTile ? 0 : 0.02;
  const highlightRatio = renderMode === "flat" ? 0.04 : (isRoundTile ? 0.015 : 0.18);
  const shadowRatio = renderMode === "flat" ? 0.02 : (isRoundTile ? 0.035 : 0.22);

  const border = mixRgb(base, black, borderRatio);
  const studFill = mixRgb(base, white, studRatio);
  const highlight = mixRgb(base, white, highlightRatio);
  const shadow = mixRgb(base, black, shadowRatio);
  const grout = mixRgb(base, black, materialMode === "square_1x1" ? 0.05 : 0.03);

  const compensationRatio = compensation?.darkenRatio ?? 0;
  const compensatedFace = compensationRatio > 0 ? mixRgb(base, black, compensationRatio) : base;
  const compensatedBorder = compensationRatio > 0 ? mixRgb(border, black, compensationRatio * 0.65) : border;
  const compensatedStud = compensationRatio > 0 ? mixRgb(studFill, black, compensationRatio * 0.5) : studFill;

  return {
    face: rgbToCss(compensatedFace),
    border: rgbToCss(compensatedBorder),
    grout: rgbToCss(grout),
    studFill: rgbToCss(compensatedStud),
    studStroke: rgbToCss(mixRgb(compensatedStud, black, 0.10)),
    highlight: rgbToCss(highlight),
    shadow: rgbToCss(shadow)
  };
}
