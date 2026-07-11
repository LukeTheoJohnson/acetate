// rng.js — seeded pseudo-random number generator + small helpers.
// Everything the DJ generates is deterministic given a seed, so a saved
// song can be reproduced note-for-note from its seed + evolution log.
(function (SDJ) {
  'use strict';

  // mulberry32 — tiny, fast, good-enough PRNG.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Derive a 32-bit seed from a string (xfnv1a).
  function seedFromString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  }

  const Rng = {
    make: makeRng,
    seedFromString,
    // pick a random element
    pick(rng, arr) {
      return arr[Math.floor(rng() * arr.length)];
    },
    // integer in [min, max] inclusive
    int(rng, min, max) {
      return min + Math.floor(rng() * (max - min + 1));
    },
    // float in [min, max)
    range(rng, min, max) {
      return min + rng() * (max - min);
    },
    // coin flip with probability p of true
    chance(rng, p) {
      return rng() < p;
    },
  };

  SDJ.Rng = Rng;
})(window.SDJ = window.SDJ || {});
