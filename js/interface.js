/* ==========================================================================
   interface.js — связывает HTML со звуком: слушает нажатия и двигает картинку.

   Что здесь происходит:
     1. ползунки   (input[data-param])       → App.state + звук
     2. типы волн  (.wave-btn)               → App.state.synthN.wave
     3. эффекты    (.fx__led)                → вкл/выкл
     4. секвенсор  (кружки .seq-cell)        → App.state.pattern
     5. кнопки     (play, mode, reset, mute) → действия
     6. анимация кадра: подсветка шага, индикаторы уровня, столбики барабанов
   ========================================================================== */
(function () {
  'use strict';

  const App = window.App;
  const cfg = App.config;
  const engine = App.engine;
  const seq = App.sequencer;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- 1. ползунки ---------- */

  /** Доля заполнения для CSS (--v): градиент трека зависит от неё */
  function paintSlider(el) {
    const min = Number(el.min);
    const max = Number(el.max);
    el.style.setProperty('--v', (Number(el.value) - min) / (max - min));
  }

  function bindSliders() {
    $$('input[data-param]').forEach((el) => {
      const path = el.dataset.param;
      el.value = App.getParam(path);                 // стартовое положение из state.js
      paintSlider(el);
      el.addEventListener('input', () => {
        const value = Number(el.value);
        App.setParam(path, value);
        paintSlider(el);
        if (path === 'tempo') $('#tempo-value').textContent = Math.round(value);
        engine.applyParam(path);
      });
    });
    $('#tempo-value').textContent = App.state.tempo;
  }

  /* ---------- 2. типы волн ---------- */

  function bindWaves() {
    $$('.wave-group').forEach((group) => {
      const source = group.dataset.source;
      const buttons = $$('.wave-btn', group);
      const show = () => buttons.forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.wave === App.state[source].wave));
      });
      buttons.forEach((b) => b.addEventListener('click', () => {
        App.state[source].wave = b.dataset.wave;
        show();
      }));
      show();
    });
  }

  /* ---------- 3. эффекты ---------- */

  function bindEffects() {
    $$('.fx').forEach((panel) => {
      const id = panel.id;
      const led = $('.fx__led', panel);
      const show = () => {
        const on = App.state[id].on;
        panel.dataset.on = String(on);
        led.setAttribute('aria-pressed', String(on));
      };
      led.addEventListener('click', () => {
        App.state[id].on = !App.state[id].on;
        show();
        engine.applyParam(id + '.on');
      });
      show();
    });
  }

  /* ---------- 4. секвенсор ---------- */

  const cells = {};            // cells['s1'][3] — кнопка

  function showCell(track, step) {
    const el = cells[track][step];
    const state = App.state.pattern[track][step];
    el.dataset.state = String(state);
    el.setAttribute('aria-label', `${track} шаг ${step + 1}: ${cfg.CELL_NAMES[state]}`);
  }

  function buildSequencer() {
    cfg.TRACKS.forEach((t) => {
      const row = document.getElementById(t.rowId);
      cells[t.id] = [];
      for (let step = 0; step < cfg.STEPS; step++) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'seq-cell';
        el.dataset.step = String(step);
        row.appendChild(el);
        cells[t.id].push(el);
        showCell(t.id, step);

        /* Клик: выкл → красный → жёлтый → зелёный → выкл */
        el.addEventListener('click', () => {
          const next = (App.state.pattern[t.id][step] + 1) % cfg.CELL_NAMES.length;
          App.state.pattern[t.id][step] = next;
          showCell(t.id, step);
          if (next > 0 && !App.state.playing) seq.preview(t.id, step, next);
        });
      }
    });
  }

  function refreshSequencer() {
    cfg.TRACKS.forEach((t) => {
      for (let step = 0; step < cfg.STEPS; step++) showCell(t.id, step);
    });
  }

  /* ---------- 5. кнопки ---------- */

  function showPlaying() {
    const on = App.state.playing;
    $('#btn-play').setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('is-playing', on);
    if (!on) {
      $$('.seq-cell.is-current').forEach((c) => c.classList.remove('is-current'));
      lastStep = -1;
    }
  }

  function bindButtons() {
    /* Треугольник: играть / остановить */
    $('#btn-play').addEventListener('click', () => {
      seq.toggle();
      showPlaying();
    });

    /* Красный круг: мир ↔ изнанка (переключает js/modes.js) */
    $('#btn-mode').addEventListener('click', () => {
      App.modes.set(App.state.mode === 'world' ? 'upside' : 'world');
    });

    /* Стрелки: сбросить все выбранные кружки. Музыка при этом не останавливается. */
    const reset = $('#btn-reset');
    reset.addEventListener('click', () => {
      seq.clear();
      refreshSequencer();
      reset.classList.remove('is-spinning');
      void reset.offsetWidth;                       // перезапуск анимации, если нажали повторно
      reset.classList.add('is-spinning');
    });
    reset.addEventListener('animationend', () => reset.classList.remove('is-spinning'));

    /* Динамик: выключить звук */
    const mute = $('#btn-mute');
    mute.addEventListener('click', () => {
      App.state.muted = !App.state.muted;
      mute.setAttribute('aria-pressed', String(App.state.muted));
      mute.setAttribute('aria-label', App.state.muted ? 'Включить звук' : 'Выключить звук');
      engine.applyParam('master');
    });

    /* Пробел — играть/остановить (удобно при показе) */
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      e.preventDefault();
      seq.toggle();
      showPlaying();
    });
  }

  /* ---------- 6. анимация кадра ---------- */

  let lastStep = -1;
  const meters = {};
  const meterLevels = {};
  let vizBars = new Array(24).fill(0);
  const canvas = $('#drums-visualizer');
  const g = canvas.getContext('2d');

  function bindMeters() {
    $$('.meter').forEach((m) => {
      meters[m.dataset.meter] = $$('.meter__dot', m);
      meterLevels[m.dataset.meter] = 0;
    });
  }

  /** 5 кружков заполняются цветом снизу вверх: сначала нижний, потом выше (--lit 0…1 у каждого) */
  function paintMeter(id, level) {
    const dots = meters[id];
    const n = dots.length;
    dots.forEach((dot, i) => {
      const fromBottom = n - 1 - i;
      dot.style.setProperty('--lit', String(Math.min(1, Math.max(0, level * n - fromBottom))));
    });
  }

  function flashDot(source) {
    const dot = $('#' + source + ' .panel__dot');
    dot.classList.remove('is-hit');
    void dot.offsetWidth;
    dot.classList.add('is-hit');
  }

  /* Столбики барабанов: у каждого своя случайная высота, к которой он плавно тянется,
     потом выбирает новую — они просто растут и уменьшаются вразнобой. */
  const vizTarget = vizBars.map(() => 0.5);
  const vizNext = vizBars.map(() => 0);

  function drawVisualizer() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const n = vizBars.length;
    const gap = 3;
    const bw = (w - 16 - gap * (n - 1)) / n;
    const now = performance.now();
    const range = App.state.playing ? 1 : 0.3;                       // на паузе колеблются слабее
    g.fillStyle = getComputedStyle($('#drums')).getPropertyValue('--accent').trim() || '#FFD60A';
    for (let i = 0; i < n; i++) {
      if (now > vizNext[i]) {
        vizTarget[i] = 0.12 + Math.random() * 0.88 * range;
        vizNext[i] = now + 120 + Math.random() * 380;
      }
      vizBars[i] += (vizTarget[i] - vizBars[i]) * 0.18;
      const bh = Math.max(2, vizBars[i] * (h - 8));
      g.fillRect(8 + i * (bw + gap), (h - bh) / 2, bw, bh);
    }
  }

  function frame() {
    requestAnimationFrame(frame);

    /* События секвенсора, время которых наступило */
    if (engine.ctx && App.state.playing) {
      seq.consumeDue(engine.ctx.currentTime).forEach((ev) => {
        if (lastStep >= 0) {
          ['s1', 's2', 'kick', 'snare', 'hat'].forEach((id) => cells[id][lastStep].classList.remove('is-current'));
        }
        cfg.TRACKS.forEach((t) => cells[t.id][ev.step].classList.add('is-current'));
        lastStep = ev.step;
        ev.hits.forEach(flashDot);
      });
    }

    /* Индикаторы уровня: быстро растут, медленно опускаются */
    Object.keys(meters).forEach((id) => {
      const level = engine.ctx ? engine.getLevel(id) : 0;
      const m = meterLevels[id];
      meterLevels[id] = m + (level - m) * (level > m ? 0.2 : 0.07);   // плавно наполняется и плавно убывает
      paintMeter(id, meterLevels[id]);
    });

    drawVisualizer();
  }

  /* Столбики glitch: каждому своя скорость и сдвиг — CSS-анимация идёт вразнобой */
  function scatterGlitch() {
    $$('.fx-art--bar').forEach((bar) => {
      bar.style.setProperty('--dur', (0.45 + Math.random() * 0.9).toFixed(2) + 's');
      bar.style.setProperty('--delay', (-Math.random() * 1.5).toFixed(2) + 's');
    });
  }

  /* ---------- запуск ---------- */

  App.ui = {
    init() {
      bindSliders();
      bindWaves();
      bindEffects();
      buildSequencer();
      bindButtons();
      bindMeters();
      scatterGlitch();
      showPlaying();
      requestAnimationFrame(frame);
    },
  };
})();
