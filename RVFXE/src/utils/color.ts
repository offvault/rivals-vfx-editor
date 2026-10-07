import type { RGBA, RGBNormalized, SessionEntry, RvfxpRecipe, ColorParam } from '@/types';

/**
 * Convert RGBA (potentially HDR, values > 1.0) to a displayable hex string.
 * Normalizes by the max channel so the hue is preserved visually.
 */
export function rgbaToDisplayHex(r: number, g: number, b: number): string {
  const maxVal = Math.max(r, g, b, 1.0);
  const normR = r / maxVal;
  const normG = g / maxVal;
  const normB = b / maxVal;

  const toHex = (c: number): string => {
    const numC = Number.isNaN(c) ? 0 : Number(c);
    const hex = Math.round(numC * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(normR)}${toHex(normG)}${toHex(normB)}`;
}

/**
 * Convert a hex color string (#RGB or #RRGGBB) to normalized 0–1 RGB.
 */
export function hexToRgba(hex: string): RGBNormalized {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex[1] + hex[2], 16);
    g = parseInt(hex[3] + hex[4], 16);
    b = parseInt(hex[5] + hex[6], 16);
  }
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/**
 * Convert (potentially HDR) RGB to HSL, normalizing first.
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const maxVal = Math.max(r, g, b, 1.0);
  if (maxVal === 0) return [0, 0, 0];
  const r_norm = r / maxVal;
  const g_norm = g / maxVal;
  const b_norm = b / maxVal;

  const max = Math.max(r_norm, g_norm, b_norm);
  const min = Math.min(r_norm, g_norm, b_norm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r_norm: h = (g_norm - b_norm) / d + (g_norm < b_norm ? 6 : 0); break;
      case g_norm: h = (b_norm - r_norm) / d + 2; break;
      case b_norm: h = (r_norm - g_norm) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

/**
 * Convert HSL back to normalized 0–1 RGB.
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r, g, b];
}

/**
 * Apply a new color to a param, respecting intensity preservation and grayscale ignoring.
 */
export function applyColorToParam(
  currentRgba: RGBA,
  newColor: RGBNormalized,
  options: {
    preserveIntensity: boolean;
    ignoreGrayscale: boolean;
    ignoreGrayscaleCheck?: boolean;
  }
): RGBA {
  const isGrayscale = currentRgba.R === currentRgba.G && currentRgba.G === currentRgba.B;

  if (!options.ignoreGrayscaleCheck && options.ignoreGrayscale && isGrayscale) {
    console.debug('[applyColorToParam] Skipping grayscale param', { currentRgba });
    return currentRgba;
  }

  if (options.preserveIntensity) {
    const originalIntensity = Math.max(currentRgba.R, currentRgba.G, currentRgba.B);
    if (originalIntensity === 0) return { ...currentRgba, R: 0, G: 0, B: 0 };

    const maxNew = Math.max(newColor.r, newColor.g, newColor.b);
    if (maxNew === 0) return { ...currentRgba, R: 0, G: 0, B: 0 };

    const normalizedNewR = newColor.r / maxNew;
    const normalizedNewG = newColor.g / maxNew;
    const normalizedNewB = newColor.b / maxNew;

    return {
      ...currentRgba,
      R: normalizedNewR * originalIntensity,
      G: normalizedNewG * originalIntensity,
      B: normalizedNewB * originalIntensity,
    };
  } else {
    return { ...currentRgba, R: newColor.r, G: newColor.g, B: newColor.b };
  }
}

/**
 * Apply a hue shift (in degrees) to an RGBA value.
 */
export function applyHueShiftToRgba(
  rgba: RGBA,
  hueShiftDegrees: number,
  ignoreGrayscale: boolean
): RGBA {
  const isGrayscale = rgba.R === rgba.G && rgba.G === rgba.B;
  if (ignoreGrayscale && isGrayscale) return rgba;

  const originalIntensity = Math.max(rgba.R, rgba.G, rgba.B);
  const [h, s, l] = rgbToHsl(rgba.R, rgba.G, rgba.B);

  let newHue = h + (hueShiftDegrees / 360);
  if (newHue < 0) newHue += 1;
  if (newHue > 1) newHue -= 1;

  const [r, g, b] = hslToRgb(newHue, s, l);

  return {
    ...rgba,
    R: r * originalIntensity,
    G: g * originalIntensity,
    B: b * originalIntensity,
  };
}

/**
 * Check if a hex color string is valid.
 */
export function isValidHex(hex: string): boolean {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
}

/**
 * Checks whether a given parameter is an Enemy VFX parameter.
 */
export function isEnemyParameter(param: { paramName: string; fileName?: string; relativePath?: string }): boolean {
  const combined = `${param.paramName} ${param.fileName || ''} ${param.relativePath || ''}`.toLowerCase();
  return combined.includes('enemy');
}

/**
 * Inverts the hue (+180 degrees) of an RGBA color for Enemy VFX distinction.
 */
export function invertColorRgba(rgba: RGBA): RGBA {
  const isGrayscale = rgba.R === rgba.G && rgba.G === rgba.B;
  if (isGrayscale) {
    // For grayscale, invert intensity (1 - value)
    const maxVal = Math.max(rgba.R, rgba.G, rgba.B, 1.0);
    const inverted = Math.max(0, 1.0 - (rgba.R / maxVal)) * maxVal;
    return { ...rgba, R: inverted, G: inverted, B: inverted };
  }

  return applyHueShiftToRgba(rgba, 180, false);
}

/**
 * Generate N procedurally varied colors based on a palette of sample swatches.
 * Ensures each file/parameter receives a unique, aesthetic variation clustered
 * around the sample palette swatches.
 */
export function generateProceduralColors(
  sampleHexes: string[],
  count: number,
  jitterAmount = 0.35
): string[] {
  if (sampleHexes.length === 0) return ['#ffffff'];
  if (count <= 0) return [];

  const validSamples = sampleHexes.filter(isValidHex);
  const palette = validSamples.length > 0 ? validSamples : ['#3b82f6', '#10b981', '#f59e0b'];

  // Convert palette to HSL
  const hslPalette = palette.map(hex => {
    const rgb = hexToRgba(hex);
    return rgbToHsl(rgb.r, rgb.g, rgb.b);
  });

  const results: string[] = [];

  for (let i = 0; i < count; i++) {
    // Pick base color and neighbor for smooth interpolation
    const palIdx = i % hslPalette.length;
    const nextIdx = (palIdx + 1) % hslPalette.length;
    const [h1, s1, l1] = hslPalette[palIdx];
    const [h2, s2, l2] = hslPalette[nextIdx];

    // Sub-position within segment
    const t = Math.sin((i / count) * Math.PI * 2) * 0.5 + 0.5;

    // Pseudo-random deterministic hash for jitter based on index
    const hash = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const rand1 = (hash - Math.floor(hash));
    const hash2 = Math.cos(i * 39.346 + 11.135) * 24634.63;
    const rand2 = (hash2 - Math.floor(hash2));
    const hash3 = Math.sin(i * 91.22 + 45.1) * 31415.92;
    const rand3 = (hash3 - Math.floor(hash3));

    // Interpolate hue with shortest circular path
    let diffH = h2 - h1;
    if (diffH > 0.5) diffH -= 1.0;
    if (diffH < -0.5) diffH += 1.0;
    let baseH = h1 + diffH * t;

    // Apply controlled jitter
    const hueJitter = (rand1 - 0.5) * jitterAmount * 0.25;
    let finalH = baseH + hueJitter;
    if (finalH < 0) finalH += 1;
    if (finalH > 1) finalH -= 1;

    const finalS = Math.min(1.0, Math.max(0.15, (s1 * (1 - t) + s2 * t) + (rand2 - 0.5) * jitterAmount * 0.2));
    const finalL = Math.min(0.9, Math.max(0.15, (l1 * (1 - t) + l2 * t) + (rand3 - 0.5) * jitterAmount * 0.15));

    const [r, g, b] = hslToRgb(finalH, finalS, finalL);
    results.push(rgbaToDisplayHex(r, g, b));
  }

  return results;
}

/**
 * Intelligently synthesize a Recipe V2 from a legacy Season 10 .rvfxp session parameter list.
 * Normalizes HDR emissive values, separates friendly from enemy parameters,
 * detects dominant hue clusters to reconstruct masterColor, shuffle palettes, and brightness.
 */
export function inferRecipeFromLegacySession(sessionData: SessionEntry[]): RvfxpRecipe {
  if (!sessionData || sessionData.length === 0) {
    return {
      mode: 'single',
      masterColor: '#ffffff',
      enemyColor: '#38bdf8',
      shufflePalette: ['#ffffff'],
      preserveIntensity: true,
      ignoreGrayscale: true,
      proceduralJitter: 0.35,
      brightnessMultiplier: 1.0,
      opacityValue: 1.0,
      hueShift: 0,
    };
  }

  // 1. Separate enemy parameters from friendly parameters
  const friendlyEntries: SessionEntry[] = [];
  const enemyEntries: SessionEntry[] = [];

  for (const entry of sessionData) {
    if (!entry.rgba) continue;
    if (isEnemyParameter(entry)) {
      enemyEntries.push(entry);
    } else {
      friendlyEntries.push(entry);
    }
  }

  // Helper to filter chromatic entries (non-grayscale, non-black)
  const isChromatic = (rgba: RGBA): boolean => {
    const maxVal = Math.max(rgba.R, rgba.G, rgba.B);
    if (maxVal <= 0.001) return false;
    const diffRG = Math.abs(rgba.R - rgba.G);
    const diffGB = Math.abs(rgba.G - rgba.B);
    const diffRB = Math.abs(rgba.R - rgba.B);
    if (diffRG / maxVal < 0.03 && diffGB / maxVal < 0.03 && diffRB / maxVal < 0.03) {
      return false;
    }
    const [, s] = rgbToHsl(rgba.R, rgba.G, rgba.B);
    return s > 0.08;
  };

  const chromaticFriendly = friendlyEntries.filter(e => isChromatic(e.rgba));
  const candidateEntries = chromaticFriendly.length > 0 ? chromaticFriendly : friendlyEntries;

  // 2. Group friendly hues into 12 buckets (30° each) to find dominant clusters
  interface HueCluster {
    bucketIndex: number;
    count: number;
    sumR: number;
    sumG: number;
    sumB: number;
  }
  const buckets: HueCluster[] = Array.from({ length: 12 }, (_, i) => ({
    bucketIndex: i,
    count: 0,
    sumR: 0,
    sumG: 0,
    sumB: 0,
  }));

  const allPeaks: number[] = [];
  const allAlphas: number[] = [];

  for (const entry of candidateEntries) {
    const { R, G, B, A } = entry.rgba;
    allPeaks.push(Math.max(R, G, B));
    if (typeof A === 'number') allAlphas.push(A);

    // Normalize HDR values by dividing by max(R,G,B, 1.0)
    const maxChan = Math.max(R, G, B, 1.0);
    const normR = R / maxChan;
    const normG = G / maxChan;
    const normB = B / maxChan;

    const [h] = rgbToHsl(normR, normG, normB);
    const hueDeg = (h * 360) % 360;
    const bucketIdx = Math.min(11, Math.max(0, Math.floor(hueDeg / 30)));

    buckets[bucketIdx].count++;
    buckets[bucketIdx].sumR += normR;
    buckets[bucketIdx].sumG += normG;
    buckets[bucketIdx].sumB += normB;
  }

  // Sort buckets by count descending
  const populatedBuckets = buckets.filter(b => b.count > 0).sort((a, b) => b.count - a.count);

  let masterColor = '#ffffff';
  let mode: 'single' | 'shuffle' | 'procedural' | '12color' = 'single';
  const shufflePalette: string[] = [];

  if (populatedBuckets.length > 0) {
    const primary = populatedBuckets[0];
    const avgR = primary.sumR / primary.count;
    const avgG = primary.sumG / primary.count;
    const avgB = primary.sumB / primary.count;
    masterColor = rgbaToDisplayHex(avgR, avgG, avgB);
    shufflePalette.push(masterColor);

    // If secondary clusters have >= 15% of total chromatic entries, set mode to 'shuffle'
    const totalCount = candidateEntries.length || 1;
    for (let i = 1; i < populatedBuckets.length; i++) {
      const b = populatedBuckets[i];
      if (b.count / totalCount >= 0.15) {
        const cR = b.sumR / b.count;
        const cG = b.sumG / b.count;
        const cB = b.sumB / b.count;
        const clusterHex = rgbaToDisplayHex(cR, cG, cB);
        if (!shufflePalette.includes(clusterHex)) {
          shufflePalette.push(clusterHex);
        }
      }
    }

    if (shufflePalette.length > 1) {
      mode = 'shuffle';
    }
  }

  // 3. Determine enemyColor
  const chromaticEnemy = enemyEntries.filter(e => isChromatic(e.rgba));
  let enemyColor: string;
  if (chromaticEnemy.length > 0) {
    let eSumR = 0, eSumG = 0, eSumB = 0;
    for (const e of chromaticEnemy) {
      const maxChan = Math.max(e.rgba.R, e.rgba.G, e.rgba.B, 1.0);
      eSumR += e.rgba.R / maxChan;
      eSumG += e.rgba.G / maxChan;
      eSumB += e.rgba.B / maxChan;
    }
    enemyColor = rgbaToDisplayHex(eSumR / chromaticEnemy.length, eSumG / chromaticEnemy.length, eSumB / chromaticEnemy.length);
  } else {
    // Invert masterColor hue (+180°)
    const masterRgb = hexToRgba(masterColor);
    const [mh, ms, ml] = rgbToHsl(masterRgb.r, masterRgb.g, masterRgb.b);
    let compH = mh + 0.5;
    if (compH > 1) compH -= 1;
    const [er, eg, eb] = hslToRgb(compH, Math.max(0.6, ms), ml);
    enemyColor = rgbaToDisplayHex(er, eg, eb);
  }

  // 4. Brightness multiplier based on median peak
  let brightnessMultiplier = 1.0;
  if (allPeaks.length > 0) {
    allPeaks.sort((a, b) => a - b);
    const medianPeak = allPeaks[Math.floor(allPeaks.length / 2)];
    if (medianPeak > 1.2) {
      brightnessMultiplier = Math.min(10.0, parseFloat(medianPeak.toFixed(2)));
    }
  }

  // 5. Opacity based on median alpha
  let opacityValue = 1.0;
  if (allAlphas.length > 0) {
    allAlphas.sort((a, b) => a - b);
    const medianA = allAlphas[Math.floor(allAlphas.length / 2)];
    if (medianA < 0.99 && medianA > 0.01) {
      opacityValue = parseFloat(medianA.toFixed(2));
    }
  }

  return {
    mode,
    masterColor,
    enemyColor,
    shufflePalette: shufflePalette.length > 0 ? shufflePalette : [masterColor],
    preserveIntensity: true,
    ignoreGrayscale: true,
    proceduralJitter: 0.35,
    brightnessMultiplier,
    opacityValue,
    hueShift: 0,
  };
}

/**
 * Algorithmatically applies a Recipe V2 across a list of ColorParam items.
 * Updates RGBA values and returns the modified array.
 */
export function applyRecipeToParams(params: ColorParam[], recipe: RvfxpRecipe): ColorParam[] {
  if (!params || params.length === 0 || !recipe) return params;

  const masterRgb = hexToRgba(recipe.masterColor || '#ffffff');
  const enemyRgb = recipe.enemyColor ? hexToRgba(recipe.enemyColor) : null;
  const jitter = typeof recipe.proceduralJitter === 'number' ? recipe.proceduralJitter : 0.35;
  const brightness = typeof recipe.brightnessMultiplier === 'number' ? recipe.brightnessMultiplier : 1.0;
  const opacity = typeof recipe.opacityValue === 'number' ? recipe.opacityValue : 1.0;

  // Pre-generate procedural colors if in procedural mode
  const proceduralColors = recipe.mode === 'procedural' && recipe.shufflePalette && recipe.shufflePalette.length > 0
    ? generateProceduralColors(recipe.shufflePalette, params.length, jitter)
    : [];

  const palette = recipe.shufflePalette && recipe.shufflePalette.length > 0 ? recipe.shufflePalette : [recipe.masterColor || '#ffffff'];

  // Distribute shuffle colors by paramName to keep matching parameters harmonious
  const paramNameToColor: Record<string, string> = {};
  if (recipe.mode === 'shuffle') {
    const uniqueParamNames = [...new Set(params.map(p => p.paramName))];
    uniqueParamNames.forEach((name, idx) => {
      paramNameToColor[name] = palette[idx % palette.length];
    });
  }

  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    const isEnemy = isEnemyParameter(param);

    let targetRgb = masterRgb;
    if (isEnemy && enemyRgb) {
      targetRgb = enemyRgb;
    } else if (!isEnemy && recipe.mode === 'shuffle' && paramNameToColor[param.paramName]) {
      targetRgb = hexToRgba(paramNameToColor[param.paramName]);
    } else if (!isEnemy && recipe.mode === 'procedural' && proceduralColors[i]) {
      targetRgb = hexToRgba(proceduralColors[i]);
    }

    // Apply color respecting preserveIntensity & ignoreGrayscale
    let newRgba = applyColorToParam(param.rgba, targetRgb, {
      preserveIntensity: recipe.preserveIntensity ?? true,
      ignoreGrayscale: recipe.ignoreGrayscale ?? true,
    });

    // Apply hue shift if any
    if (recipe.hueShift) {
      newRgba = applyHueShiftToRgba(newRgba, recipe.hueShift, recipe.ignoreGrayscale ?? true);
    }

    // Apply brightness multiplier
    if (brightness !== 1.0) {
      newRgba = {
        ...newRgba,
        R: Math.min(100, Math.max(0, newRgba.R * brightness)),
        G: Math.min(100, Math.max(0, newRgba.G * brightness)),
        B: Math.min(100, Math.max(0, newRgba.B * brightness)),
      };
    }

    // Apply opacity value
    if (opacity !== 1.0) {
      newRgba = { ...newRgba, A: Math.min(1.0, Math.max(0, opacity)) };
    }

    param.rgba = newRgba;
  }

  return params;
}

