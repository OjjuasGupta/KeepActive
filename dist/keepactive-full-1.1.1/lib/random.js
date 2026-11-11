/* lib/random.js
 * Deterministic-feeling but non-patterned randomization helpers.
 * Loaded both as a content script and imported by the service worker/pages.
 *
 * Everything here is intentionally seed-free and stateless: we never use
 * Math.random() in a way that produces repeating sequences.
 */

(function (root) {
  'use strict';

  /** Uniform float in [min, max). */
  function float(min, max) {
    return min + Math.random() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  function int(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Delay in ms, jittered around a base, but drawn from a distribution
   * centred slightly away from the bounds so the mean is not exactly the
   * midpoint (avoids a machine-detectable "average interval").
   * Returns an integer number of milliseconds clamped to [minMs, maxMs].
   */
  function delayMs(minSec, maxSec) {
    const lo = Math.max(1, minSec);
    const hi = Math.max(lo + 1, maxSec);
    // Beta-ish shape via averaging two uniforms -> triangular around the middle,
    // then push the peak off-centre by a random amount each call.
    const peak = float(0.30, 0.70);
    const a = Math.random();
    const b = Math.random();
    const t = (a + b) / 2;                 // triangular-ish in [0,1]
    const skewed = t < 0.5
      ? 0.5 * Math.pow(2 * t, 1 + peak)     // pulls toward the low end
      : 1 - 0.5 * Math.pow(2 * (1 - t), 2 - peak);
    return Math.round(float(lo, hi) * 0.35 + (lo + skewed * (hi - lo)) * 0.65) * 1000;
  }

  /** True with probability p (0..1). */
  function chance(p) {
    return Math.random() < p;
  }

  /** Pick one element from an array. */
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** Random small integer delta, excluding 0 (so the move is actually visible). */
  function nonZeroInt(minAbs, maxAbs) {
    const mag = int(minAbs, maxAbs);
    return chance(0.5) ? mag : -mag;
  }

  /**
   * Human-ish idle streak: sometimes we do nothing for a while even when
   * scheduled. Returns true if this cycle should be skipped entirely.
   */
  function shouldSkip(pSkip) {
    return chance(pSkip);
  }

  const api = {
    float,
    int,
    delayMs,
    chance,
    pick,
    nonZeroInt,
    shouldSkip
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SARandom = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
