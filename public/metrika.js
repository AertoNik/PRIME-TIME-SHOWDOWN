/*
 * PRIME TIME: SHOWDOWN — Яндекс Метрика (счётчик 114123351), только после согласия посетителя.
 *
 * Alpha 1.9.7 (13.11.2026): ON (ENABLED = true), switched on by `npm run legal:release -- --approved` together with
 * the approved documents (Р-28: Privacy Policy 6, «Родителям» 5, the consent page; privacy 6 on the server) and the
 * CSP hosts — see docs/METRIKA.md. With ENABLED = false this file does nothing at all: no banner, no request, no cookie.
 *
 * A plain script next to index.html, not part of the game bundle. The game never calls it, and it never
 * touches the game, its saves, PRIME ID, PRIME CLOUD or PRIME SHOP.
 *
 * - Until the visitor presses «Разрешить», nothing is loaded from Yandex and no Metrika cookie is set.
 *   «Не разрешать», blocked browser storage, an under-14 answer at the PRIME ID age question, or any host
 *   other than the official site leave Metrika off.
 * - Switched off: Webvisor (session replay and form recording), the click map, outbound-link and download
 *   tracking, hash tracking, e-commerce, user parameters and user IDs.
 * - The game is a single page and never changes its address while running (only the payment return
 *   parameters are removed by the game itself), so Metrika's own page view is the one view per page load.
 * - Metrika reads the address and the referrer by itself, even in its first service request. It therefore
 *   starts only on a clean address: no #hash and no parameters except advertising labels (utm_*, yclid,
 *   ysclid, gclid, gbraid, wbraid, fbclid, vkclid, erid, _openstat). Any other parameter — the payment
 *   return ?prime_pay&inv, a token, anything unknown — means no Metrika on that page load. It also does not
 *   start when the visitor arrives from the payment page. This script never rewrites the address.
 * - accurateTrackBounce stays on: one extra request after 15 s, so a single-page visit is not always a
 *   bounce.
 * - The legal page legal/<lang>/analytics.html (data-pt-page="analytics") uses this file for the
 *   allow / withdraw buttons. That page never loads the counter itself.
 */
(function () {
  'use strict';
  /** The owner's switch. true only together with the CSP hosts in index.html and the approved legal pages. */
  var ENABLED = true;
  var ID = 114123351;
  var KEY = 'primetime-showdown-analytics-v1';
  var AGE_LOCK_KEY = 'primetime-showdown-agegate-v1'; // the game's under-14 mark (src/ui/legalUI.ts)
  var LANG_KEY = 'primetime-showdown-lang-v1'; // the game's language (src/i18n/lang.ts)
  var HOSTS = { 'primetimeshowdown.online': 1, 'www.primetimeshowdown.online': 1 };
  var ADS = /^(utm_[a-z0-9_]{1,40}|yclid|ysclid|gclid|gbraid|wbraid|fbclid|vkclid|erid|_openstat)$/i;
  var PAY_REF = /(^|\.)robokassa\.(ru|com|kz)$/i;

  function store() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }
  function choice() {
    var s = store();
    if (!s) return null;
    try {
      var r = JSON.parse(s.getItem(KEY) || 'null');
      if (r && r.v === 1 && (r.c === 'granted' || r.c === 'denied')) return r.c;
    } catch (e) {
      /* unreadable: no choice yet */
    }
    return null;
  }
  function saveChoice(c) {
    var s = store();
    if (!s) return false;
    try {
      s.setItem(KEY, JSON.stringify({ v: 1, c: c, at: new Date().toISOString() }));
      return choice() === c;
    } catch (e) {
      return false;
    }
  }
  function under14() {
    var s = store();
    try {
      return !!s && Number(s.getItem(AGE_LOCK_KEY) || 0) > Date.now();
    } catch (e) {
      return false;
    }
  }
  function lang() {
    var page = document.documentElement.getAttribute('lang');
    if (document.documentElement.getAttribute('data-pt-page') === 'analytics' && (page === 'ru' || page === 'en')) return page;
    var s = store();
    try {
      var l = s && s.getItem(LANG_KEY);
      if (l === 'ru' || l === 'en') return l;
    } catch (e) {
      /* default below */
    }
    var n = (navigator.language || '').toLowerCase();
    return /^(ru|uk|be|kk)\b/.test(n) || n === '' ? 'ru' : 'en';
  }

  /** No #hash, and every parameter is an advertising label (Metrika would read anything else too). */
  function cleanAddress() {
    if (location.href.indexOf('#') >= 0) return false;
    var ok = true;
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (!ADS.test(k)) ok = false;
    });
    return ok;
  }
  /** Arriving from the payment page: Metrika is not started on that page load. */
  function fromPayment() {
    try {
      return !!document.referrer && PAY_REF.test(new URL(document.referrer).hostname);
    } catch (e) {
      return false;
    }
  }

  /** Metrika's cookies and browser-storage entries (all start with _ym) are removed after a refusal. */
  function forget() {
    var host = location.hostname;
    var domains = ['', host, '.' + host.replace(/^www\./, '')];
    document.cookie.split(';').forEach(function (part) {
      var name = part.split('=')[0].trim();
      if (name.indexOf('_ym') !== 0) return;
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
    var s = store();
    if (!s) return;
    try {
      for (var i = s.length - 1; i >= 0; i--) {
        var k = s.key(i);
        if (k && k.indexOf('_ym') === 0) s.removeItem(k);
      }
    } catch (e) {
      /* nothing more can be done here */
    }
  }

  var started = false;
  function start() {
    if (started || !HOSTS[location.hostname] || under14() || choice() !== 'granted' || !cleanAddress() || fromPayment()) return;
    started = true;
    var ym = (window.ym =
      window.ym ||
      function () {
        (window.ym.a = window.ym.a || []).push(arguments);
      });
    ym.l = Date.now();
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://mc.yandex.ru/metrika/tag.js?id=' + ID;
    document.head.appendChild(s);
    ym(ID, 'init', { webvisor: false, clickmap: false, trackLinks: false, trackHash: false, accurateTrackBounce: true });
  }
  /**
   * A refusal made in another tab. Metrika has no switch for a counter that is already running (tested:
   * disableYaCounter is read only at start), so this page keeps it until it is reloaded. Its cookies go
   * now, and leftovers go on every later load (boot).
   */
  function stop() {
    window['disableYaCounter' + ID] = true;
    forget();
  }

  var T = {
    ru: {
      label: 'Аналитика посещений',
      // 1.9.7: the owner's text (13.11.2026)
      title: 'Помогите сделать PRIME TIME: SHOWDOWN лучше!',
      text: 'Мы используем Яндекс.Метрику, чтобы узнавать, сколько игроков посещают наш сайт, и улучшать игру. С вашего разрешения сервис использует cookie и технические данные браузера для статистики посещаемости. Вы можете отказаться — это никак не повлияет на игру. Изменить решение можно в настройках.',
      kids: 'Если вам меньше 14 лет, решение принимает родитель или законный представитель.',
      more: 'Подробнее',
      allow: 'Разрешить',
      deny: 'Не разрешать',
      on: 'Сейчас: аналитика разрешена.',
      off: 'Сейчас: аналитика выключена.',
      none: 'Сейчас: выбор ещё не сделан — аналитика выключена.',
      nostore: 'Браузер не даёт сохранить выбор — аналитика выключена.',
      withdraw: 'Отозвать согласие',
      saved: 'Выбор сохранён. Если игра уже открыта в другой вкладке, отказ полностью вступит в силу после её перезагрузки.'
    },
    en: {
      label: 'Visit analytics',
      title: 'Help us make PRIME TIME: SHOWDOWN better!',
      text: 'We use Yandex Metrica to learn how many players visit our site and to improve the game. With your permission the service uses cookies and technical browser data for visit statistics. You can say no — it does not affect the game at all. You can change your choice in Settings.',
      kids: 'If you are under 14, a parent or legal guardian decides.',
      more: 'Details',
      allow: 'Allow',
      deny: 'Don\'t allow',
      on: 'Now: analytics allowed.',
      off: 'Now: analytics off.',
      none: 'Now: no choice yet — analytics off.',
      nostore: 'This browser does not let the choice be saved — analytics off.',
      withdraw: 'Withdraw consent',
      saved: 'Choice saved. If the game is already open in another tab, a withdrawal takes full effect once that tab is reloaded.'
    }
  };

  function css() {
    if (document.getElementById('pt-consent-css')) return;
    var st = document.createElement('style');
    st.id = 'pt-consent-css';
    st.textContent =
      // 1.9.7: the game's own look — a dark studio panel, a teal LIVE edge, the display font of the titles
      '#pt-consent{position:fixed;left:50%;bottom:calc(44px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:10000;' +
      'width:min(520px,calc(100vw - 20px));box-sizing:border-box;padding:14px 16px 12px;border-radius:16px;' +
      'background:linear-gradient(180deg,rgba(26,32,84,.98),rgba(12,15,44,.98));border:1px solid rgba(34,240,224,.45);' +
      'box-shadow:0 12px 34px rgba(0,0,0,.6),0 0 22px rgba(34,240,224,.18);color:#eef2ff;' +
      'font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left;user-select:text;-webkit-user-select:text;' +
      'animation:pt-consent-in .35s ease-out}' +
      '@keyframes pt-consent-in{from{opacity:0;transform:translate(-50%,14px)}}' +
      '@media (prefers-reduced-motion:reduce){#pt-consent{animation:none}}' +
      '#pt-consent h2{margin:0 0 6px;font:900 14px/1.25 var(--font-display,"Arial Black",system-ui,sans-serif);letter-spacing:.02em;color:#fff}' +
      '#pt-consent h2::before{content:"";display:inline-block;width:8px;height:8px;margin:0 8px 1px 0;border-radius:50%;background:#ff3a5a;box-shadow:0 0 8px #ff3a5a}' +
      '#pt-consent p{margin:0 0 8px;color:#d6dcff}#pt-consent small{display:block;margin:0 0 10px;color:#9aa4d6;font-size:11.5px}#pt-consent a{color:#22f0e0}' +
      '#pt-consent .pt-row{display:flex;gap:8px;flex-wrap:wrap}' +
      '#pt-consent button{flex:1 1 120px;min-height:40px;padding:9px 12px;border-radius:12px;border:1px solid rgba(34,240,224,.6);' +
      'background:rgba(0,0,0,.25);color:#eef2ff;font:800 12.5px/1 var(--font-display,"Arial Black",system-ui,sans-serif);letter-spacing:.03em;cursor:pointer}' +
      // both answers equally visible: an honest choice, nothing pushed
      '#pt-consent button:focus-visible{outline:2px solid #22f0e0;outline-offset:2px}';
    document.head.appendChild(st);
  }

  function banner() {
    if (document.getElementById('pt-consent')) return;
    var t = T[lang()];
    css();
    var box = document.createElement('div');
    box.id = 'pt-consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', t.label);
    box.setAttribute('data-nosnippet', '');
    var h = document.createElement('h2');
    h.textContent = t.title;
    var p = document.createElement('p');
    p.textContent = t.text + ' ';
    var kids = document.createElement('small');
    kids.textContent = t.kids;
    var a = document.createElement('a');
    a.href = './legal/' + lang() + '/analytics.html';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = t.more;
    p.appendChild(a);
    var row = document.createElement('div');
    row.className = 'pt-row';
    [
      ['granted', t.allow],
      ['denied', t.deny]
    ].forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b[1];
      if (b[0] === 'granted') btn.className = 'pt-yes';
      btn.addEventListener('click', function () {
        saveChoice(b[0]);
        box.remove();
        if (b[0] === 'granted') start();
        else stop();
      });
      row.appendChild(btn);
    });
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(kids);
    box.appendChild(row);
    // the game listens to taps and keys on the page: what happens inside the box stays inside it
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown', 'keyup', 'wheel'].forEach(function (type) {
      box.addEventListener(type, function (e) {
        e.stopPropagation();
      });
    });
    document.body.appendChild(box);
  }

  /** legal/<lang>/analytics.html: the current state and the two buttons. */
  function controls(root) {
    var t = T[lang()];
    var state = document.createElement('p');
    var row = document.createElement('p');
    var note = document.createElement('p');
    note.className = 'doc-meta';
    function paint() {
      var c = choice();
      state.textContent = !store() ? t.nostore : c === 'granted' ? t.on : c === 'denied' ? t.off : t.none;
    }
    [
      ['granted', t.allow],
      ['denied', t.withdraw]
    ].forEach(function (b, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'doc-btn';
      btn.textContent = b[1];
      btn.addEventListener('click', function () {
        if (saveChoice(b[0])) note.textContent = t.saved;
        if (b[0] === 'denied') forget();
        paint();
      });
      row.appendChild(btn);
      if (!i) row.appendChild(document.createTextNode(' '));
    });
    root.appendChild(state);
    root.appendChild(row);
    root.appendChild(note);
    paint();
  }

  /**
   * For the game's Settings (1.9.7): the row «Аналитика посещений» shows only while the counter is enabled.
   * allow() / decline() are the visitor's own choice, the same as the banner's buttons.
   */
  window.PrimeAnalytics = {
    enabled: ENABLED,
    choice: function () {
      return ENABLED ? choice() : null;
    },
    allow: function () {
      if (!ENABLED || !saveChoice('granted')) return false;
      var box = document.getElementById('pt-consent');
      if (box) box.remove();
      start();
      return true;
    },
    decline: function () {
      if (!ENABLED) return false;
      var ok = saveChoice('denied');
      var box = document.getElementById('pt-consent');
      if (box) box.remove();
      stop();
      return ok;
    },
    running: function () {
      return started;
    },
    page: function () {
      return './legal/' + lang() + '/analytics.html';
    }
  };

  function boot() {
    if (!ENABLED) return;
    var page = document.documentElement.getAttribute('data-pt-page');
    if (page === 'analytics') {
      var root = document.getElementById('pt-analytics-controls');
      if (root) controls(root);
      return;
    }
    if (!HOSTS[location.hostname] || !store()) return;
    var c = choice();
    if (c !== 'granted' || under14()) forget(); // leftovers of a counter that ran before a refusal
    if (under14()) return;
    if (c === 'granted') start();
    else if (c === null) banner();
  }

  window.addEventListener('storage', function (e) {
    if (!ENABLED || e.key !== KEY || document.documentElement.getAttribute('data-pt-page') === 'analytics') return;
    var c = choice();
    var box = document.getElementById('pt-consent');
    if (c !== null && box) box.remove();
    if (c === 'granted') {
      window['disableYaCounter' + ID] = false;
      start();
    } else if (c === 'denied') stop();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
