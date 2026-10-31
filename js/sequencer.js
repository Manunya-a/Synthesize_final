/* ==========================================================================
   sequencer.js — «дирижёр»: каждые 25 мс заглядывает на 0.12 с вперёд
   и расставляет ноты по часам AudioContext. Так ритм не плывёт, даже если вкладка занята.

   Шаг = шестнадцатая доля: 60 / BPM / 4 секунд. 16 шагов = один такт.
   Основная дорожка (арпеджио Cmaj7 + бас + «сердцебиение») играет сама — см. playMain().
   Кружки только ДОБАВЛЯЮТ звуки поверх неё (что именно — см. config.js).
   ========================================================================== */
(function () {
  'use strict';

  const App = window.App;
  const cfg = App.config;
  const engine = App.engine;
  const voices = App.voices;
  const music = App.music;

  const seq = (App.sequencer = {
    timer: null,
    step: 0,            // следующий шаг (0…15)
    total: 0,           // сколько шагов прозвучало всего (нужно для «качания» фильтра)
    nextTime: 0,        // когда прозвучит следующий шаг
    queue: [],          // события для интерфейса: { time, step, hits: ['synth1', ...] }
  });

  /* ---------- нотный разбор ---------- */

  /** Сейчас «чётный» такт основной дорожки? Тогда в басу E, а нижнее C арпеджио меняется на B (Cmaj7/E) */
  function bassIsE(total) {
    return Math.floor(total / cfg.STEPS) % 2 === 1;
  }

  /** Нота арпеджио для позиции в цикле (offset сдвигает по аккорду) с учётом баса и режима */
  function arpMidi(cycleIndex, total, octaveUp) {
    let midi = music.noteToMidi(cfg.ARP_CYCLE[cycleIndex % cfg.ARP_CYCLE.length]);
    if (bassIsE(total) && midi % 12 === 0) midi -= 1;
    return midi + (octaveUp ? 12 : 0) + cfg.MODES[App.state.mode].octave;   // изнанка — ниже
  }

  /** «Качание» фильтра: плавно раскрывается и закрывается за SWEEP_BARS тактов (0.45…1.6) */
  function sweepAt(total) {
    const phase = (total / cfg.STEPS / cfg.SWEEP_BARS) % 1;
    return 0.45 + 1.15 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
  }

  /* ---------- одна дорожка на одном шаге ---------- */

  /** Добавочный звук от кружка (и проба при клике). Возвращает источник звука или null. */
  function triggerTrack(track, step, cell, time, stepDur, total) {
    if (!cell) return null;
    if (track === 's1') {
      const idx = step + cfg.S1_EXTRA_OFFSET[cell];
      voices.playSynth('synth1', arpMidi(idx, total, true), time, stepDur * 0.8, cfg.S1_EXTRA_VELOCITY[cell], sweepAt(total));
      return 'synth1';
    }
    if (track === 's2') {
      voices.playSynth('synth2', music.noteToMidi(cfg.S2_NOTES[cell]), time, stepDur * 1.8, 0.8, 1);
      return 'synth2';
    }
    const vel = cfg.DRUM_VELOCITY[cell];
    if (track === 'kick') voices.playKick(time, vel);
    if (track === 'snare') voices.playSnare(time, vel);
    if (track === 'hat') voices.playHat(time, vel);
    return 'drums';
  }

  /** ОСНОВНАЯ ДОРОЖКА: арпеджио + бас + сердцебиение. Играет всегда, кружки не нужны. */
  function playMain(step, time, stepDur, total) {
    const accent = cfg.ARP_ACCENT_STEPS.indexOf(step) >= 0;
    voices.playSynth('synth1', arpMidi(step, total, false), time, stepDur * 0.9,
      accent ? 1 : 0.8, (accent ? 1.35 : 1) * sweepAt(total));

    if (step % 8 === 0) {                                          // бас на шагах 0 и 8
      const note = cfg.MAIN_BASS[bassIsE(total) ? 1 : 0];
      voices.playSynth('synth2', music.noteToMidi(note), time, stepDur * 7, 1, 1);
    }
    const kick = cfg.MAIN_KICK[step];
    if (kick) voices.playKick(time, kick);
  }

  /* ---------- планировщик ---------- */

  function stepDuration() {
    return 60 / App.state.tempo / 4;
  }

  function scheduleStep(step, time) {
    const stepDur = stepDuration();
    const hits = ['synth1'];
    playMain(step, time, stepDur, seq.total);
    if (step % 8 === 0) hits.push('synth2');
    if (cfg.MAIN_KICK[step]) hits.push('drums');
    cfg.TRACKS.forEach((t) => {
      const cell = App.state.pattern[t.id][step];
      const source = triggerTrack(t.id, step, cell, time, stepDur, seq.total);
      if (source && hits.indexOf(source) < 0) hits.push(source);
    });
    seq.queue.push({ time, step, hits });
  }

  function tick() {
    const ctx = engine.ctx;
    while (seq.nextTime < ctx.currentTime + cfg.LOOKAHEAD) {
      scheduleStep(seq.step, seq.nextTime);
      seq.nextTime += stepDuration();
      seq.step = (seq.step + 1) % cfg.STEPS;
      seq.total += 1;
    }
  }

  /* ---------- управление ---------- */

  seq.start = function () {
    if (App.state.playing) return;
    const ctx = engine.ensure();
    seq.step = 0;
    seq.total = 0;
    seq.queue = [];
    seq.nextTime = ctx.currentTime + 0.06;
    App.state.playing = true;
    tick();
    seq.timer = setInterval(tick, cfg.TIMER_MS);
  };

  seq.stop = function () {
    if (!App.state.playing) return;
    clearInterval(seq.timer);
    seq.timer = null;
    seq.queue = [];
    App.state.playing = false;
  };

  seq.toggle = function () {
    if (App.state.playing) seq.stop();
    else seq.start();
    return App.state.playing;
  };

  /** Сбросить все выбранные кружки */
  seq.clear = function () {
    App.state.pattern = {};
    cfg.TRACKS.forEach((t) => { App.state.pattern[t.id] = new Array(cfg.STEPS).fill(0); });
  };

  /** Проба звука при клике по кружку — сразу, не дожидаясь шага */
  seq.preview = function (track, step, cell) {
    const ctx = engine.ensure();
    return triggerTrack(track, step, cell, ctx.currentTime + 0.01, stepDuration(), 0);
  };

  /** Для интерфейса: вернуть и забрать события, время которых уже наступило */
  seq.consumeDue = function (now) {
    const due = [];
    while (seq.queue.length && seq.queue[0].time <= now) due.push(seq.queue.shift());
    return due;
  };
})();
