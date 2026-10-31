/* ==========================================================================
   state.js — ИЗМЕНЯЕМОЕ состояние: положения ползунков, выбранные волны, рисунок секвенсора.
   Ползунки в HTML связаны с состоянием атрибутом data-param.
   Пример: data-param="ch-s1.volume" → App.state['ch-s1'].volume
   Значения ползунков — числа от 0 до 1 (кроме темпа: он в ударах в минуту).
   ========================================================================== */
(function () {
  'use strict';

  const App = window.App;

  /** Рисунок секвенсора: по массиву из 16 чисел на дорожку (0 выкл, 1 красный, 2 жёлтый, 3 зелёный).
      Сначала пусто: основная мелодия играет сама, а кружки только добавляют звуки поверх неё. */
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

    /* Источники: тип волны и огибающая */
    synth1: { wave: 'square',   attack: 0.15, release: 0.35 },
    synth2: { wave: 'sawtooth', attack: 0.05, release: 0.5  },
    drums:  { kick: 0.85, snare: 0.6, hat: 0.45 },               // громкость каждого барабана

    /* Каналы: громкость и панорама (0 — левее, 0.5 — центр, 1 — правее) */
    'ch-s1': { volume: 0.6,  pan: 0.4 },
    'ch-s2': { volume: 0.55, pan: 0.6 },
    'ch-dr': { volume: 0.65, pan: 0.5 },

    /* Эффекты: включён ли и сколько его */
    'fx-distortion': { on: true,  amount: 0.2 },
    'fx-delay':      { on: true,  amount: 0.4 },
    'fx-reverb':     { on: true,  amount: 0.45 },
    'fx-glitch':     { on: false, amount: 0.3 },

    pattern: createDefaultPattern(),
  };

  App.createDefaultPattern = createDefaultPattern;

  /** Прочитать значение по пути: getParam('ch-s1.volume') */
  App.getParam = function (path) {
    return path.split('.').reduce((obj, key) => obj[key], App.state);
  };

  /** Записать значение по пути: setParam('ch-s1.volume', 0.7) */
  App.setParam = function (path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((obj, key) => obj[key], App.state)[last] = value;
  };
})();
