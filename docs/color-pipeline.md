# Color quantization for LEGO mosaics: principles, history, and lessons

> A reference for engineers building image-to-physical-mosaic systems. Distilled from 25+ versions of the [BMBrick](https://www.bmbrick.com) color quantization pipeline, evaluated against the same 13-image test set across every iteration.
>
> Language: English · [中文](./color-pipeline.zh-CN.md)

---

## Table of contents

1. [The problem](#1-the-problem)
2. [Current pipeline (V25)](#2-current-pipeline-v25)
3. [Architectural decisions](#3-architectural-decisions)
4. [Verified principles](#4-verified-principles)
5. [Failed experiments](#5-failed-experiments)
6. [Version history](#6-version-history)
7. [Parameter sensitivity reference](#7-parameter-sensitivity-reference)
8. [Open problems & future work](#8-open-problems--future-work)
9. [Glossary](#9-glossary)

---

## 1. The problem

LEGO sells 1×1 plates (part #3024) in 42 colors. Round 1×1 tiles (part #98138) come in 54 colors. A photograph captured by any modern phone has 16,777,216 possible RGB values per pixel. The job of a LEGO mosaic generator is to take that photo and decide, for each "pixel" in a 48×48 / 64×64 / 96×96 grid, which one of the 42 (or 54) physical brick colors to place there — and to do it in a way that the resulting buildable mosaic still looks recognizably like the input.

This is a constrained color quantization problem, but with three properties that make standard solutions inadequate:

1. **The target palette is small and physically fixed.** You cannot generate intermediate colors. The "closest" LEGO color to a particular pixel may be quite far in any perceptual space.

2. **Spatial coherence matters more than per-pixel accuracy.** Adjacent bricks that flicker between two colors look like an algorithmic glitch. A solid block of a single "close enough" color looks like deliberate stylization. The aesthetic of LEGO mosaics depends on large clean regions of single colors with deliberate transitions between them.

3. **Output is rendered at low resolution.** A 48×48 grid is 2,304 bricks total. There is no detail headroom. Every quantization decision is visible in the final piece.

A naive RGB-distance nearest-neighbor quantization produces visible color banding on skin tones, posterized gradients, and random speckle in flat regions. A naive "smooth then quantize" approach over-smooths and produces even worse banding because the quantizer has fewer intermediate colors to interpolate with. Every "obvious" improvement we tried at some point in the past 18 months turned out to either fail outright or introduce a new pathology elsewhere in the test set.

The work below documents what we shipped, what we reverted, and the rules that survived 25 versions of iteration.

### The test set

Every pipeline change is evaluated against the same 13 reference photos: 4 single-subject portraits (human + pet), 2 multi-subject portraits (couple, family), 2 wedding scenes (one studio, one outdoor), 2 landscapes, 1 close-up object, 1 deliberately blurry input (negative control), and 1 black-and-white reference. For each image we score five dimensions (background cohesion, subject detail, gradient quality, brick aesthetic, average per-pixel color error) and require: no regression on more than 15% of cases, improvement on more than 30% of cases, and an improvement-to-regression ratio above 3:1. A change that wins on one cherry-picked image and ties on the rest is not shipped.

---

## 2. Current pipeline (V25)

```
Original pixel data
        │
        ▼
┌──────────────────────────────────┐
│ applySharpen(amount = 0.4)       │  Laplacian edge enhancement
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ applyToneMap(ceiling = 235)      │  Adaptive highlight compression
│   97th percentile → highlight    │  (shadows untouched)
│   knee = clamp(hi − 35, 130, 190)│
│   v ≤ knee: passthrough          │
│   v >  knee: sqrt soft shoulder  │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ bilateralFilter                  │  Edge-preserving smoothing
│   radius = 3                     │
│   sigmaSpace = 2.5               │
│   sigmaColor = 20                │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ Per-pixel quantization           │  Weighted OKLab distance,
│   weighted OKLab (L weight = 2)  │  linear scan over 42-color
│   continuity penalty 0.008       │  palette
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ Error-driven F-S dithering       │  Floyd-Steinberg with adaptive
│   8 % – 100 % strength           │  strength keyed to per-pixel
│   serpentine scan                │  quantization distance
│   error clamp ±60 per channel    │
└──────────────────────────────────┘
        │
        ▼
   Quantized output
   (mosaic preview, PDF blueprint, parts list)
```

### Stage detail

**Sharpen (amount = 0.4)** — A small Laplacian sharpen before tone mapping. The downstream bilateral filter and quantizer both slightly soften the image; pre-sharpening compensates so eyes, nostrils, and other "recognition landmarks" survive into the output. Larger values introduce halo artifacts around bright edges; smaller values produce mushy faces.

**Tone map (sqrt soft-shoulder)** — Compresses highlights but leaves shadows alone. The 97th-percentile-driven knee adapts to the input: bright photos get aggressive compression, dim photos get little. The sqrt curve is gentle near the knee so contrast is preserved in the upper midtones. The `ceiling=235` parameter ensures the brightest output stays below the threshold that the quantizer maps to "White", so a cat's lit cheek maps to Tan or Light Bluish Gray instead of disappearing into solid white.

**Bilateral filter (r=3, σs=2.5, σc=20)** — Smooths flat regions while preserving edges. At 48–96 pixel working resolutions, a radius-3 window means <100K multiplications per image, runs in single-digit milliseconds. Replacing this with a Gaussian blur (faster but edge-destroying) was explored and rejected — it eliminates the very landmarks the sharpen step protected.

**Weighted OKLab quantization (L weight = 2.0)** — Distance is computed in OKLab perceptual color space with the L (lightness) component weighted 2× compared to a/b (chroma). The 50-color palette is stored as a flat Float32Array and scanned linearly per pixel. The L weighting is the dominant factor for "the mosaic looks like a face" — humans tolerate color shifts much more than they tolerate lightness shifts at low spatial resolution.

**Continuity penalty (0.008 for square plates, 0.003 for round tiles)** — A small additional cost when adjacent bricks would receive different colors. Prevents single-pixel speckle in flat regions. Round tiles use a lower penalty because their natural texture is more tolerant of variation. **This value is a hard floor:** any value below 0.008 causes flat regions to break apart, and the difference between 0.002 and 0.005 is measurably zero (see [failed experiments](#failed-2)).

**Error-driven Floyd-Steinberg dithering (8%–100% strength)** — Standard Floyd-Steinberg error diffusion, but the diffusion strength is scaled by the per-pixel quantization distance. Flat regions where the palette matches well get ~8% strength (essentially off, preserving clean blocks). Gradient regions where the palette doesn't cover well get up to 100% (full dithering to break up banding). Serpentine scanning (left-to-right on even rows, right-to-left on odd rows) eliminates directional artifacts. Error clamp is ±60 per channel.

---

## 3. Architectural decisions

These are the non-obvious choices that, in retrospect, made or broke the pipeline. Each shipped after explicit evaluation; each survived at least one attempt to reverse it.

### 3.1 Quantize from bilateral output, not from raw pixels

Older versions quantized each raw input pixel directly to the palette, then mixed in a small amount of smoothed result for cohesion. This produced fragmented color blocks with noise everywhere.

The current pipeline runs bilateral filtering on the full image *first*, producing clean large color regions, and then quantizes that. The quantizer sees a much smaller distribution of input colors and produces cleaner blocks naturally.

This single change is the largest contributor to "competitor previews look clean and ours used to look messy" closing.

### 3.2 Weight lightness 2× in OKLab distance

Human visual perception at low resolution is dominated by luminance edges. A face is recognized from its highlight/shadow pattern long before its hue is parsed. Weighting L at 2× compared to a/b means: when forced to pick between matching a pixel's color and matching its brightness, we always match brightness.

This rule was unshipped once (in V19, where 42/42 cases regressed) and re-shipped after we discovered it only works in combination with the soft-shoulder tone map. With a harder tone map, L weight 2× over-emphasizes already-compressed highlights and loses shadow detail.

### 3.3 Never lift shadows

The temptation in any image pipeline is to "improve" dark areas by raising their values 1–3 levels. We tried this (`v + (v/knee)*3` shadow lift in V4) and immediately regressed: blacks became gray, dark fur lost contrast against dark backgrounds, foliage shadows turned muddy.

The current pipeline does `continue` for any value at or below the knee. The darkest input pixel becomes the darkest output brick. This is essential for the "competitor previews of dark images look richer" gap, which turned out to be the absence of shadow lifting rather than any positive enhancement.

### 3.4 Bilateral, not Gaussian

A Gaussian blur is faster and simpler, but at 48–96 pixel working resolutions it destroys the eyes, nose, and mouth in any portrait — the very landmarks that the sharpen step exists to protect. Bilateral filtering at radius=3 with σ_color=20 preserves edges sharper than 20 RGB units while smoothing everything else.

At our working resolution, the bilateral filter is so fast (~5ms) that the performance argument for Gaussian doesn't apply. We rejected an early proposal to switch.

### 3.5 Linear scan over 50 colors, not KD-tree

A 50-color palette in a flat Float32Array, scanned linearly per pixel, beats a KD-tree on modern CPUs. The tree height for 50 nodes is ~6 levels, but each level has a branch with poor prediction. The linear scan is cache-friendly and runs with no branch mispredictions on the hot path.

This is one of those cases where the "more sophisticated" data structure is slower because the dataset is too small for asymptotic complexity to matter. Don't reach for KD-trees until your palette is in the thousands of colors.

### 3.6 Evaluate against the same 13 images every time

The single most important meta-decision was committing to a fixed 13-image evaluation set with a 5-axis scoring rubric. Every quantization change is run against every image and reviewed by an independent reviewer (clean context, no access to changelog or playbook — only the scores and diff PNGs).

Every regression we caught was caught because the same photos kept getting evaluated. Several promising changes that won on 8 cases regressed on 3, which only became visible because the full set was always run. A change that fixes the one image you've been staring at for an hour will, more often than not, break others you haven't checked.

---

## 4. Verified principles

These are the rules that survived multiple iterations and explicit attempts to violate them. Each is stated with its parameter context — pipelines that change other parameters may invalidate these.

### 4.1 The less pre-processing, the more accurate the color

Every "enhancement" step before quantization (auto-levels, color cast removal, vibrance, shadow lift) regressed on at least 7/13 cases when tested. The quantizer needs to see the source image as close to original as possible. Pre-processing's job is exclusively edge preservation (sharpen) and noise removal (bilateral) — never to "improve" colors.

### 4.2 L weight ∈ [1.5, 2.5] is correct when tone-mapped with sqrt soft shoulder

L weight 2.0 wins over L weight 1.0 in 13/13 cases when the tone map uses the sqrt soft-shoulder with ceiling=235. With aggressive tone mapping (ceiling < 220 or hard knee), L weight 2.0 *loses* because the highlights are already compressed; weighting L higher just makes the loss worse. The rule is conditional on the tone map.

### 4.3 Do not lift shadows

Verified in every dark-region test image. The "competitor previews of dark images look better" gap was entirely an absence-of-bug — they don't lift shadows, we used to.

### 4.4 Bilateral filter beats Gaussian at this resolution

At 48–96 pixel working resolution, edge preservation is non-negotiable. Bilateral at radius=3 with σ_color=20 is the sweet spot. σ_color < 15 lets noise through; σ_color > 25 over-smooths and produces *more* banding (see [failed experiments](#failed-4)).

### 4.5 Serpentine scanning eliminates directional artifacts

Floyd-Steinberg error diffusion alone produces a faint diagonal artifact pattern visible at small scales. Alternating scan direction by row (with the kernel mirrored on odd rows) eliminates this with no parameter tuning required. This was an 8/13 improvement with zero regressions.

### 4.6 continuityPenalty has a hard floor at 0.008

For square plates. Below this the quantizer loses the ability to suppress single-pixel speckle in flat regions. Two values below 0.008 (0.002 and 0.005) tested as indistinguishably bad. Round tiles allow 0.003 because their natural texture absorbs variation. Going *above* 0.012 starts to over-constrain gradient regions.

### 4.7 Error-driven dithering beats edge-based

Older versions detected "gradient regions" via local color spread (edge-based signal) and applied dithering there. This activated in too many false regions. The current approach uses the per-pixel quantization distance as the dithering trigger: if the closest palette color is far in OKLab space, dither aggressively. If it's close, leave alone. This correctly identifies the regions that actually need dithering (where the palette doesn't cover the source).

### 4.8 Error diffusion in RGB space is acceptable

We considered diffusing errors in OKLab space (more perceptually accurate). The implementation cost is high (RGB → OKLab → diffuse → OKLab → RGB) and the win was not measurable on the test set. RGB-space diffusion is fine in practice.

---

## 5. Failed experiments

Each entry follows the same template: **the change** / **expected** / **what actually happened** / **root cause** / **the lesson**. These are the most informative failures from ~25 versions of iteration.

<a id="failed-1"></a>
### 5.1 S-curve 1.15

**The change.** `applySCurve(data, 1.15)` before quantization, intended as a small contrast bump.

**Expected.** ~5–10% reduction in muddy mid-tones.

**What actually happened.** Cat faces went almost entirely white. Highlights at RGB 200–230 all pushed to 245–255, then quantized to White.

**Root cause.** The S-curve formula was non-linear in its contrast parameter: `1.15` input produced 1.79× effective contrast. The function was named in a way that implied linearity but the math wasn't.

**Lesson.** When a function takes a strength parameter, plot the input→output transfer function before trusting the number. Every tunable filter is opaque until graphed.

<a id="failed-2"></a>
### 5.2 `const smoothData = originalData`

**The change.** Nothing, technically — a line of code that looked harmless.

**Expected.** The smoothing step would blur low-frequency regions before quantization.

**What actually happened.** Speckle everywhere. Backgrounds that should have been one solid color split into 4–5 noisy patches.

**Root cause.** A months-old refactor had commented out the smoothing call and replaced it with `const smoothData = originalData`. The downstream `blendQuantizationSample(working, smooth)` was now blending the working image with itself — a no-op.

**Lesson.** Identity assignments to non-trivial variables are a code smell. Now we assert that intermediate stages produce a measurable transformation: `assert(distance(smoothed, original) > threshold)`.

<a id="failed-3"></a>
### 5.3 Bayer ordered dithering

**The change.** Replace Floyd-Steinberg error diffusion with Bayer 8×8 ordered dithering in gradient regions.

**Expected.** Cleaner gradients with structured texture.

**What actually happened.** Every gradient in 6/6 reviewed cases got worse. The 8×8 pattern was clearly visible at 48–96 pixel resolutions.

**Root cause.** Bayer matrices were designed for high-resolution displays where the pattern dissolves into perceptual smoothness. An 8×8 pattern in a 48×48 grid occupies 16% of the image — it reads as a regular grid of dots, not as smoothness. LEGO mosaic aesthetics depend on large clean color blocks; anything that breaks them looks like a glitch.

**Lesson.** Algorithms that win at one resolution can fail completely at another. "Dithering reduces banding" is conditional on the pattern-to-pixel ratio.

<a id="failed-4"></a>
### 5.4 Bilateral filter at σ_color = 35

**The change.** Increase bilateral `sigmaColor` from 20 to 35 for stronger smoothing.

**Expected.** Smoother input → cleaner quantization → less banding.

**What actually happened.** Banding got *worse*. 7/13 cases regressed.

**Root cause.** Stronger bilateral filtering merges more nearby-but-distinct colors. At σ_color=20, skin tones contain ~80 unique RGB clusters; the quantizer has plenty of variation to distribute across the 6 available skin-tone LEGO colors. At σ_color=35, those collapse to ~30 clusters and the quantizer has nothing in between to interpolate with, so it picks the two nearest LEGO colors and produces hard bands.

**Lesson.** "Smoothing the input" is not always a quantization win. The quantizer needs *enough* distinct colors to choose smart transitions.

<a id="failed-5"></a>
### 5.5 continuityPenalty 0.002 and 0.005

**The change.** Lower continuityPenalty from 0.008 to 0.002. When that regressed, try 0.005 as a "compromise".

**Expected.** Lower penalty → freer gradients → smoother transitions.

**What actually happened.** Both values regressed identically. The avgErr difference between 0.002 and 0.005 was <0.001 — statistically a tie.

**Root cause.** continuityPenalty wasn't a continuous knob — it was a switch. The error-driven dithering activates whenever the per-pixel quantization error exceeds a threshold, and in flat regions that error is also high because our palette doesn't perfectly cover all RGB space. continuityPenalty is the only thing suppressing the activation. Anything below 0.008 turns the switch off.

**Lesson.** When two values of a parameter produce identical bad outcomes, the parameter isn't the problem. Look at what else is happening in the pipeline.

### 5.6 Lightness weight 2× (the shipped → unshipped → re-shipped saga)

**The change.** Weight the L component 2× in OKLab distance, then unship it after a regression, then re-ship it later.

**Expected.** Better perceptual matching at low resolution.

**What actually happened.** It won on most test sets, regressed 42/42 on v19, then won again after tone map changes.

**Root cause.** L weight 2× interacts with the tone-map aggressiveness. With a hard tone map, weighting L higher over-emphasizes already-compressed highlights and loses shadow detail. With the sqrt soft-shoulder, the interaction is benign.

**Lesson.** "Always" and "never" rules in image pipelines are usually wrong. The right framing is "this principle holds when these other parameters are also set to X". We were burned twice on this one.

### 5.7 The "AI-assisted V4 rewrite" — stacked side effects

**The change.** A separate fidelity rendering pipeline ("V4") with three independent darkening modules: tone-map highlights, darken the baseplate slightly, dim the studs on light bricks.

**Expected.** Realistic physical effects layered cleanly.

**What actually happened.** Everything came out gray. The color-distance function started preferring gray bricks. Black grid lines visually thickened. Saturated reds and yellows lost their pop.

**Root cause.** Three modules each assumed they were the only one running. The tone-mapper darkened highlights assuming normal exposure. The baseplate compensation darkened all bricks assuming highlights were untouched. The stud-darkening dimmed light bricks assuming the baseplate hadn't moved. All three were correct in isolation. Stacked, they produced ~0.20 effective brightness on light areas — a 5× darkening nobody designed for.

V5 tried to patch with parameter tuning. V5 introduced overexposed highlights. V5.1 retuned and introduced color casts on white bricks. The whole branch was eventually thrown out.

**Lesson.** Stacked multiplicative effects that each "make sense" alone don't compose. The pipeline needs one place that owns the final brightness/contrast envelope, and every sub-stage must declare what it assumes about the others' outputs.

### 5.8 Guided filter as post-quantization denoising

**The change.** Apply a guided filter to the quantized output to clean up speckle.

**Expected.** Smoother regions in the final mosaic without re-quantizing.

**What actually happened.** No visible improvement. The guided filter operates in continuous color space, but the output had already been mapped to discrete brick colors. Any "improvement" got re-discretized back to the same brick palette.

**Root cause.** Post-quantization denoising must operate in the discrete palette space. Treating it as a continuous-domain problem makes the filtering invisible.

**Lesson.** Once data is discretized, continuous-domain operations on it have no effect unless you also change the discretization. Block-anchor (4×4 majority voting in the discrete palette) was much more effective.

### 5.9 Gemini V6 — "less is more" overshoot

**The change.** Remove tone map + sharpen + shadow lift. Drop bilateral to r=2, σ_color=15. OKLab distance with no weighting.

**Expected.** A cleaner pipeline aligned with the "less pre-processing" principle.

**What actually happened.** Shadows lost depth, gradients became too uniform, fine details vanished.

**Root cause.** The "less pre-processing" principle was correct in direction but V6 took it past the productive point. Some pre-processing (sharpen for edge protection, mild tone map for highlight preservation) is essential at this resolution.

**Lesson.** Most principles are local extrema. Pushing them further always eventually regresses. The interesting question is always "how much further can we push this before it breaks?", not "should we do this?".

### 5.10 Block anchor at weight 0.6+

**The change.** Block-anchor regularization (4×4 majority voting) at higher weights to enforce more spatial coherence.

**Expected.** Cleaner large color regions.

**What actually happened.** Backgrounds locked correctly but subject detail was destroyed — eyes, nostrils, and high-frequency features were averaged out by the 4×4 voting.

**Root cause.** Block anchor must be weak enough not to override genuine high-frequency signal. Weight 0.40 with despeckle is the sweet spot.

**Lesson.** Spatial regularization is a "small dose" tool. Strong doses kill the very signal you want to preserve.

### 5.11 Despeckle without block anchor

**The change.** Apply morphological despeckle (single-pixel cleanup) as a standalone step.

**Expected.** Remove isolated noise pixels from flat regions.

**What actually happened.** Removed genuine details — small highlights in eyes, sparse texture in fur, tiny color accents in backgrounds.

**Root cause.** Despeckle alone can't distinguish noise from intentional detail. Combined with block anchor (which provides spatial context), it works because despeckle only cleans up pixels that disagree with their block consensus.

**Lesson.** Two techniques can be complementary in a way that neither is useful alone. Cross-validation against the test set caught this — despeckle in isolation regressed on detail-rich images.

---

## 6. Version history

Condensed timeline. Each major version represents a shipped change that survived evaluation, was reverted, or was kept on a branch.

| Version | When | Headline change | Status |
|---|---|---|---|
| V1 | Early | S-Curve 1.15 + smoothImageData commented out | Reverted (failed exp. 5.1, 5.2) |
| V2 | Early | S-Curve dropped to 1.04, smooth restored | Partial fix, replaced by V3 |
| V3 | Major rewrite | sharpen(0.4) → toneMap(235) → bilateral(r3,σ20) → weighted OKLab(L×2) → adaptive F-S | **Current foundation** |
| V4 | Branch | Fidelity pipeline: tone map + baseplate compensation + stud dimming | Reverted (failed exp. 5.7) |
| V5 | Branch | V4 parameter tuning: ceiling 250, baseplate ×0.98, stud 0.03 | Reverted |
| V5.1 | Branch | V5 + ceiling 240, σ_color 18, shadow boost luma<60 | Reverted |
| V6 | Branch | Strip pre-processing: no tone map, no sharpen, no shadow lift | Reverted (failed exp. 5.9) |
| V6.1 | Branch | V6 + shadow enhancement + cp dropped to 0.005/0.003 | Reverted |
| V3.1 | Iteration | Error-driven dithering replaces edge-based | **Shipped** (principle 4.7) |
| V3.2 | Iteration | Serpentine scanning added | **Shipped** (principle 4.5) |
| V3.3 | Iteration | Region-adaptive quantization (REFINE) | On branch |
| V19 | Hyperparameter sweep | L weight 1.0 vs 2.0 study | Documented (decision 3.2) |
| V22 | Audit round 1 | Block-anchor weight 0.40 + despeckle | **Shipped** |
| V23 | Iteration | Round-tile palette tuning | **Shipped** |
| V24 | Iteration | Dark-region color matching fix | **Shipped** |
| V25 | Audit round 2 | Palette dedup + bright neutral bias | **Current** |

---

## 7. Parameter sensitivity reference

For engineers tuning their own pipelines, here is how sensitive each parameter is to perturbation in our setup:

| Parameter | Safe range | Failure mode outside range | Current value |
|---|---|---|---|
| continuityPenalty (square) | 0.008 – 0.012 | <0.008: speckle in flat regions. >0.012: gradient over-smoothing | 0.008 |
| continuityPenalty (round) | 0.003 – 0.005 | Same, looser tolerance | 0.003 |
| OKLab L weight | 1.5 – 2.5 | <1.5: noise in shadows. >2.5: highlights collapse | 2.0 |
| bilateral sigmaColor | 18 – 25 | <15: noise survives. >25: more banding (counter-intuitive) | 20 |
| bilateral radius | 2 – 3 | Marginal effect either direction | 3 |
| bilateral sigmaSpace | 2.0 – 3.0 | Marginal | 2.5 |
| ToneMap ceiling | 230 – 240 | >245: highlights blow out. <225: midtones flatten | 235 |
| Dithering strength | 0.30 – 0.50 | Higher = noise. Lower = banding | 0.38 |
| Error clamp (per channel) | ±30 – ±60 | Marginal effect | ±60 |
| Sharpen amount | 0.30 – 0.50 | Higher = halos. Lower = mushy | 0.40 |
| Block anchor weight | 0.30 – 0.50 | >0.5 kills detail. <0.3 doesn't anchor | 0.40 |

**The most sensitive parameters** are continuityPenalty (hard cliff at 0.008) and bilateral sigmaColor (sweet spot at 20). The others are forgiving within their safe ranges.

---

## 8. Open problems & future work

These are explorations we have evaluated but not yet shipped, with their current status.

### 8.1 Region-adaptive dithering (REFINE)

Classify each pixel as flat / gradient / detail and apply different dithering strategies per class. Current implementation (region-adaptive-v3) improves 9/13 cases with 0 regressions in clean-context review, but most improvements are on background regions; subject detail averaged only +0.1. Not yet a confident ship — needs to demonstrate value on medium-complexity portrait subjects' faces, eyes, fur, and clothing edges.

### 8.2 OKLab-space error diffusion

Compute and diffuse Floyd-Steinberg error in OKLab space instead of RGB. More perceptually accurate but high implementation cost (RGB → OKLab → diffuse → OKLab → RGB conversion overhead). Initial measurements didn't show a clear win; not currently planned.

### 8.3 Per-image optimal sub-palette (Wu's algorithm)

For each input image, dynamically select an optimal sub-palette from the full 42-color set, then quantize against the sub-palette. Theoretically improves color allocation efficiency. Implementation deferred — the current per-image color counts already adapt naturally because rare palette colors are rarely chosen.

### 8.4 Bayer-tile texture in flat regions only

A revisit of the Bayer dithering experiment (5.3), but only applied to verified-flat regions and at much lower amplitude. Would add intentional micro-texture without breaking the clean-blocks aesthetic. Not yet tested.

---

## 9. Glossary

**Quantization** — Mapping continuous input values (here, 16M RGB colors) to a finite output set (here, 42 LEGO colors).

**OKLab** — A perceptually uniform color space designed by Björn Ottosson. Distances in OKLab correlate well with perceived color differences. Used here for the closest-color search.

**CIEDE2000** — An earlier perceptual color distance metric, more complex than OKLab. We initially used CIEDE2000 and migrated to weighted OKLab; the perceptual quality is comparable, OKLab is simpler and faster.

**Bilateral filter** — An edge-preserving smoothing filter. Pixels are averaged with neighbors, but the average is weighted by both spatial distance and color similarity, so edges (sharp color transitions) are preserved.

**Floyd-Steinberg dithering** — A classic error-diffusion technique. The error between a pixel's true color and its quantized color is distributed to neighboring not-yet-quantized pixels with weights (7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right).

**Serpentine scanning** — A modification to Floyd-Steinberg where alternate rows scan in alternate directions, with the error-distribution kernel mirrored. Eliminates the diagonal artifact pattern of standard left-to-right F-S.

**Continuity penalty** — An extra cost added to the per-pixel color decision when adjacent pixels would receive different colors. Used to suppress single-pixel speckle in flat regions.

**Block anchor** — A spatial regularization technique where the local 4×4 (or similar) block votes for a single dominant color, and individual pixels are pulled toward that color with some weight. Improves spatial coherence in flat regions.

**Magic Cut** — In-browser background removal using an ONNX model. Reduces piece count by 60–70% on portrait subjects by replacing background with a single brick color.

**Tone map** — A function that maps input luminance to output luminance, typically used to compress highlights or boost shadows. Our pipeline uses a sqrt soft-shoulder curve for highlights only.

---

## Where to go from here

- See [BMBrick](https://www.bmbrick.com) for the live tool that uses this pipeline (free, browser-based, no upload).
- The MCP agent skill that exposes this engine to AI agents: [`@bmbrick/agent-mosaic-skill`](https://www.npmjs.com/package/@bmbrick/agent-mosaic-skill).
- 中文版本: [color-pipeline.zh-CN.md](./color-pipeline.zh-CN.md).

---

*Document maintained by the [BMBrick](https://www.bmbrick.com) team. Last updated: 2026-05-22.*
