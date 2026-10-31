
(function () {
  'use strict';

  const App = (window.App = window.App || {});

  const NOTE_INDEX = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };


  function noteToMidi(name) {
    const m = name.match(/^([A-G]#?)(\d)$/);
    return 12 * (Number(m[2]) + 1) + NOTE_INDEX[m[1]];
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  App.music = { noteToMidi, midiToFreq };

  App.config = {
    STEPS: 16,          // шагов в секвенсоре = один такт шестнадцатыми
    LOOKAHEAD: 0.12,    // на сколько секунд вперёд планируем звук
    TIMER_MS: 25,       // как часто просыпается планировщик
    SWEEP_BARS: 12,     // за сколько тактов фильтр арпеджио раскрывается и закрывается
    TEMPO: { min: 60, max: 180 },

    /* Дорожки секвенсора.
       id      — ключ в паттерне и значение data-track в HTML
       rowId   — id ряда в HTML
       source  — источник звука (synth1 / synth2 / drums)
       channel — канал, куда уходит звук (ch-s1 / ch-s2 / ch-dr) */
    TRACKS: [
      { id: 's1',    rowId: 'seq-row-s1',       source: 'synth1', channel: 'ch-s1', label: 'Synth 1' },
      { id: 's2',    rowId: 'seq-row-s2',       source: 'synth2', channel: 'ch-s2', label: 'Synth 2' },
      { id: 'kick',  rowId: 'seq-row-dr-kick',  source: 'drums',  channel: 'ch-dr', label: 'Kick'    },
      { id: 'snare', rowId: 'seq-row-dr-snare', source: 'drums',  channel: 'ch-dr', label: 'Snare'   },
      { id: 'hat',   rowId: 'seq-row-dr-hat',   source: 'drums',  channel: 'ch-dr', label: 'Hat'     },
    ],

    /* Состояния кружка: 0 выкл, 1 красный, 2 жёлтый, 3 зелёный (клик меняет по кругу) */
    CELL_NAMES: ['выключено', 'красный', 'жёлтый', 'зелёный'],

    /* ОСНОВНАЯ ДОРОЖКА играет сама, пока нажат треугольник, и не зависит от кружков:
       арпеджио Cmaj7 на Synth 1, бас на Synth 2 (такт C, такт E) и «сердцебиение» кика.
       Кружки секвенсора только ДОБАВЛЯЮТ звуки поверх неё. */
    ARP_CYCLE: ['C3', 'E3', 'G3', 'B3', 'C4', 'B3', 'G3', 'E3'],   // арпеджио Cmaj7: вверх и вниз
    ARP_ACCENT_STEPS: [0, 8],            // на этих шагах арпеджио звучит громче и ярче
    MAIN_BASS: ['C2', 'E2'],             // бас по тактам: нечётный такт C, чётный E (цикл в 2 такта)
    MAIN_KICK: { 0: 0.85, 2: 0.55, 8: 0.85, 10: 0.55 },            // шаг → сила удара

    /* Что означает цвет кружка (клик: выкл → красный → жёлтый → зелёный):
       Synth 1 — добавляет ноту арпеджио октавой выше: красный — ту же, жёлтый — ноту через одну,
                 зелёный — ноту через две (звенящая «россыпь» над основной мелодией)
       Synth 2 — добавляет бас: красный C2, жёлтый E2, зелёный G2
       Drums   — добавляет удар; цвет = громкость: красный громко, жёлтый средне, зелёный тихо */
    S1_EXTRA_OFFSET: [0, 0, 2, 4],
    S1_EXTRA_VELOCITY: [0, 0.55, 0.55, 0.55],
    S2_NOTES:    [null, 'C2', 'E2', 'G2'],
    DRUM_VELOCITY: [0, 1, 0.62, 0.34],

    /* Характер голосов. Фильтр спрятан внутри и в интерфейсе не показывается.
       cutoff   — базовая яркость (Гц)       pluck, pluckTime — «щипок» фильтра в начале ноты
       keytrack — высокие ноты ярче низких   sustain, decay   — спад громкости после атаки (бас)
       detune   — расстройка двух генераторов (центы): даёт живое «плавающее» звучание */
    VOICE: {
      synth1: { cutoff: 3000, q: 2.5, level: 0.16, detune: 9, pluck: 1.5, pluckTime: 0.12, keytrack: 0.5, sustain: 1,   decay: 0 },
      synth2: { cutoff: 520,  q: 3,   level: 0.26, detune: 6, pluck: 3.2, pluckTime: 0.25, keytrack: 0.3, sustain: 0.5, decay: 0.45 },
    },

    /* Профили режимов. Переключает красный круг.
       octave   — сдвиг арпеджио Synth 1 (полутоны): в изнанке на октаву ниже
       cutoff   — множитель яркости фильтра: в изнанке темнее
       bass     — громкость Synth 2
       sub      — добавка чистого синуса к басу Synth 2
       shelfDb  — подъём низких частот на шине (дБ)
       fx       — как меняется «сколько эффекта»: итог = amount × mul + add */
    MODES: {
      world: {
        octave: 0, cutoff: 1, bass: 1, sub: 0, shelfDb: 0,
        fx: {
          'fx-distortion': { mul: 1,   add: 0 },
          'fx-delay':      { mul: 1,   add: 0 },
          'fx-reverb':     { mul: 1,   add: 0 },
          'fx-glitch':     { mul: 1,   add: 0 },
        },
      },
      upside: {
        octave: -12, cutoff: 0.55, bass: 1.4, sub: 0.5, shelfDb: 9,
        fx: {
          'fx-distortion': { mul: 1,   add: 0.12 },
          'fx-delay':      { mul: 1.3, add: 0 },
          'fx-reverb':     { mul: 1.5, add: 0 },
          'fx-glitch':     { mul: 1.5, add: 0.05 },
        },
      },
    },
  };
})();
