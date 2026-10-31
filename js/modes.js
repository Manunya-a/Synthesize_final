/* ==========================================================================
   modes.js — переключатель «Мир ↔ Изнанка».
   Внешний вид меняется через body[data-mode] (stylesheets/layout.css),
   звук — через профиль режима в config.js (config.MODES), его применяет engine.applyMode().
   ========================================================================== */
(function () {
  'use strict';

  const App = window.App;
  let switchTimer = null;

  /** Споры, летящие вверх в изнанке: создаём один раз, анимацию задаёт animation.css */
  function buildSpores() {
    const box = document.getElementById('spores');
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('span');
      s.className = 'spore';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = 40 + Math.random() * 60 + '%';
      s.style.setProperty('--d', 10 + Math.random() * 12 + 's');
      s.style.setProperty('--delay', -Math.random() * 20 + 's');
      s.style.setProperty('--dx', Math.random() * 80 - 40 + 'px');
      box.appendChild(s);
    }
  }

  App.modes = {
    init() {
      buildSpores();
      this.apply(App.state.mode, false);
    },

    /** Сменить режим: 'world' или 'upside' */
    set(mode) {
      this.apply(mode, true);
    },

    apply(mode, animate) {
      App.state.mode = mode;
      document.body.dataset.mode = mode;

      const btn = document.getElementById('btn-mode');
      const upside = mode === 'upside';
      btn.setAttribute('aria-pressed', String(upside));
      btn.setAttribute('aria-label', upside ? 'Вернуться в Мир' : 'Перейти в Изнанку');

      if (animate) {                                 // вспышка длится ~1 секунду
        document.body.classList.add('is-switching');
        clearTimeout(switchTimer);
        switchTimer = setTimeout(() => document.body.classList.remove('is-switching'), 900);
      }
      App.engine.applyMode();                        // звук подстраивается плавно
    },
  };
})();
