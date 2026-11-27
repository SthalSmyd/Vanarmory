// 「?」の印。画面に出す説明は短い 1 行にして、くわしい説明は、印を押すとその場に開く。
//   HTML では <button type="button" class="q" data-help="説明">?</button>、スクリプトからは VanaHelp.mark('説明') で作る
(function () {
  'use strict';

  function toggle(button) {
    const next = button.nextElementSibling;
    if (next && next.classList.contains('tip')) {
      next.remove();
      button.classList.remove('open');
      return;
    }
    const tip = Object.assign(document.createElement('span'), { className: 'tip', textContent: button.dataset.help });
    button.after(tip);
    button.classList.add('open');
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest('.q[data-help]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    toggle(button);
  });

  const mark = (text) => {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'q', textContent: '?', title: '説明を開く' });
    button.dataset.help = text;
    return button;
  };
  window.VanaHelp = { mark };
})();
