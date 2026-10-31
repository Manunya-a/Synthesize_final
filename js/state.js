
(function () {
  'use strict';

  const App = window.App;
  function createDefaultPattern() {
    const pattern = {};
    ['s1', 's2', 'kick', 'snare', 'hat'].forEach((id) => { pattern[id] = new Array(16).fill(0); });
    return pattern;
  }

  App.state = {
    playing: false,       // играет ли секвенсор
    mode: 'world',        // 'world' (мир) или 'upside' (изнанка)
    muted: false,         // выключен ли звук (кнопка-динамик)

    tempo: 84,            // темп оригинальной темы
    master: 0.5,          // общая громкость

    synth1: { wave: 'square',   attack: 0.15, release: 0.35 },
    synth2: { wave: 'sawtooth', attack: 0.05, release: 0.5  },
    drums:  { kick: 0.85, snare: 0.6, hat: 0.45 },             


    'ch-s1': { volume: 0.6,  pan: 0.4 },
    'ch-s2': { volume: 0.55, pan: 0.6 },
    'ch-dr': { volume: 0.65, pan: 0.5 },


    'fx-distortion': { on: true,  amount: 0.2 },
    'fx-delay':      { on: true,  amount: 0.4 },
    'fx-reverb':     { on: true,  amount: 0.45 },
    'fx-glitch':     { on: false, amount: 0.3 },

    pattern: createDefaultPattern(),
  };

  App.createDefaultPattern = createDefaultPattern;


  App.getParam = function (path) {
    return path.split('.').reduce((obj, key) => obj[key], App.state);
  };


  App.setParam = function (path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((obj, key) => obj[key], App.state)[last] = value;
  };
})();
