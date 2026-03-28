// ============================================================
// Color Analysis Engine
// RGB → Lab conversion, K-means clustering, Delta E matching
// ============================================================

// --- RGB to Lab conversion ---

function rgbToXyz(r, g, b) {
  // Normalize to 0-1
  r /= 255; g /= 255; b /= 255;

  // Linearize (inverse sRGB companding)
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  r *= 100; g *= 100; b *= 100;

  // sRGB D65
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  return [x, y, z];
}

function xyzToLab(x, y, z) {
  // D65 reference
  const xn = 95.047, yn = 100.000, zn = 108.883;
  x /= xn; y /= yn; z /= zn;

  const epsilon = 0.008856;
  const kappa = 903.3;

  x = x > epsilon ? Math.cbrt(x) : (kappa * x + 16) / 116;
  y = y > epsilon ? Math.cbrt(y) : (kappa * y + 16) / 116;
  z = z > epsilon ? Math.cbrt(z) : (kappa * z + 16) / 116;

  const L = 116 * y - 16;
  const a = 500 * (x - y);
  const b = 200 * (y - z);
  return [L, a, b];
}

function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16)
  ];
}

function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

// --- Delta E (CIE76) ---

function deltaE(lab1, lab2) {
  return Math.sqrt(
    Math.pow(lab1[0] - lab2[0], 2) +
    Math.pow(lab1[1] - lab2[1], 2) +
    Math.pow(lab1[2] - lab2[2], 2)
  );
}

// --- K-Means Clustering ---

function kMeans(pixels, k, maxIter = 20) {
  if (pixels.length === 0) return [];
  if (pixels.length <= k) return pixels.map(p => ({ rgb: p, count: 1 }));

  // Initialize centroids with k-means++
  const centroids = [pixels[Math.floor(Math.random() * pixels.length)].slice()];

  for (let i = 1; i < k; i++) {
    const distances = pixels.map(p => {
      const minDist = Math.min(...centroids.map(c =>
        Math.pow(p[0] - c[0], 2) + Math.pow(p[1] - c[1], 2) + Math.pow(p[2] - c[2], 2)
      ));
      return minDist;
    });
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalDist;
    for (let j = 0; j < distances.length; j++) {
      rand -= distances[j];
      if (rand <= 0) {
        centroids.push(pixels[j].slice());
        break;
      }
    }
    if (centroids.length <= i) {
      centroids.push(pixels[Math.floor(Math.random() * pixels.length)].slice());
    }
  }

  let assignments = new Array(pixels.length);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign pixels to nearest centroid
    let changed = false;
    for (let i = 0; i < pixels.length; i++) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let j = 0; j < k; j++) {
        const dist = Math.pow(pixels[i][0] - centroids[j][0], 2) +
                     Math.pow(pixels[i][1] - centroids[j][1], 2) +
                     Math.pow(pixels[i][2] - centroids[j][2], 2);
        if (dist < minDist) {
          minDist = dist;
          minIdx = j;
        }
      }
      if (assignments[i] !== minIdx) {
        assignments[i] = minIdx;
        changed = true;
      }
    }

    if (!changed) break;

    // Update centroids
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < pixels.length; i++) {
      const c = assignments[i];
      sums[c][0] += pixels[i][0];
      sums[c][1] += pixels[i][1];
      sums[c][2] += pixels[i][2];
      counts[c]++;
    }
    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        centroids[j][0] = sums[j][0] / counts[j];
        centroids[j][1] = sums[j][1] / counts[j];
        centroids[j][2] = sums[j][2] / counts[j];
      }
    }
  }

  // Count cluster sizes
  const counts = new Array(k).fill(0);
  for (let i = 0; i < pixels.length; i++) {
    counts[assignments[i]]++;
  }

  return centroids.map((c, i) => ({
    rgb: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])],
    count: counts[i]
  })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
}

// --- Color Extraction from Canvas ---

function extractDominantColors(canvas, numColors = 5) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Sample from center 60% of image to avoid background
  const marginX = Math.floor(width * 0.2);
  const marginY = Math.floor(height * 0.2);
  const sampleWidth = width - 2 * marginX;
  const sampleHeight = height - 2 * marginY;

  const imageData = ctx.getImageData(marginX, marginY, sampleWidth, sampleHeight);
  const data = imageData.data;

  // Sample every 4th pixel for performance
  const pixels = [];
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Filter out very dark and very light pixels (background/shadows)
    const brightness = (r + g + b) / 3;
    if (brightness > 25 && brightness < 240) {
      // Filter out very gray pixels (low saturation — likely background)
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      if (saturation > 0.05 || brightness < 60 || brightness > 200) {
        pixels.push([r, g, b]);
      }
    }
  }

  if (pixels.length < 10) {
    // Not enough colored pixels — try without saturation filter
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      if (brightness > 15 && brightness < 245) {
        pixels.push([r, g, b]);
      }
    }
  }

  if (pixels.length === 0) {
    return [];
  }

  const clusters = kMeans(pixels, numColors);

  return clusters.map(c => {
    const hex = '#' + c.rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    return {
      rgb: c.rgb,
      hex: hex.toUpperCase(),
      lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]),
      percentage: c.count
    };
  });
}

// --- Palette Matching ---

function matchColorToPalette(colorLab, paletteColors) {
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const pc of paletteColors) {
    const pcLab = hexToLab(pc.hex);
    const dist = deltaE(colorLab, pcLab);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = pc;
    }
  }

  return { paletteColor: bestMatch, distance: bestDistance };
}

function analyzeColors(dominantColors, palette) {
  const results = dominantColors.map(color => {
    const match = matchColorToPalette(color.lab, palette.colors);
    let verdict, level;

    if (match.distance < 10) {
      verdict = "Great match!";
      level = "great";
    } else if (match.distance < 18) {
      verdict = "Close enough";
      level = "ok";
    } else if (match.distance < 28) {
      verdict = "Slightly off";
      level = "warning";
    } else {
      verdict = "Not in your palette";
      level = "bad";
    }

    return {
      detectedColor: color,
      closestPaletteColor: match.paletteColor,
      distance: Math.round(match.distance * 10) / 10,
      verdict,
      level
    };
  });

  // Overall verdict
  const levels = results.map(r => r.level);
  let overallVerdict, overallLevel;

  const greatCount = levels.filter(l => l === "great").length;
  const okCount = levels.filter(l => l === "ok").length;
  const badCount = levels.filter(l => l === "bad").length;
  const total = levels.length;

  if (greatCount + okCount === total) {
    overallVerdict = "This looks great on you!";
    overallLevel = "great";
  } else if (badCount === 0) {
    overallVerdict = "Pretty good — close to your palette";
    overallLevel = "ok";
  } else if (badCount <= total / 2) {
    overallVerdict = "Some colors don't match your palette";
    overallLevel = "warning";
  } else {
    overallVerdict = "This isn't in your color palette";
    overallLevel = "bad";
  }

  return { results, overallVerdict, overallLevel };
}
