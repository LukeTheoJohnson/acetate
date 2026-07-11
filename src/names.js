// names.js — generates evocative track titles for saved bangers.
(function (SDJ) {
  'use strict';

  const ADJ = [
    'Neon', 'Velvet', 'Midnight', 'Liquid', 'Crystal', 'Broken', 'Golden',
    'Electric', 'Faded', 'Hollow', 'Distant', 'Chrome', 'Analog', 'Lucid',
    'Phantom', 'Sunken', 'Static', 'Cosmic', 'Feral', 'Molten',
  ];

  const NOUN = [
    'Tide', 'Circuit', 'Mirage', 'Pulse', 'Horizon', 'Echo', 'Drift',
    'Signal', 'Bloom', 'Vector', 'Ember', 'Halo', 'Fracture', 'Current',
    'Static', 'Ritual', 'Machine', 'Dusk', 'Gravity', 'Voyage',
  ];

  SDJ.Names = {
    generate(rng) {
      const pick = (arr) => arr[Math.floor(rng() * arr.length)];
      return pick(ADJ) + ' ' + pick(NOUN);
    },
  };
})(window.SDJ = window.SDJ || {});
