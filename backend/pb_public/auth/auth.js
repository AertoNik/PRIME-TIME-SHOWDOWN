// PRIME TIME: SHOWDOWN — Alpha 1.8.2: the pages the email links open (served by PocketBase from
// pb_public, same origin as the API). They replace PocketBase's dashboard pages so the dashboard
// itself (/_/) can stay closed to the internet on a real server.
// The token arrives after «#» (never sent to any server in a request line or a log) and is removed
// from the address bar at once.
(function () {
  'use strict';
  var page = document.body.getAttribute('data-page');
  // 1.8.4: Russian or English, as the browser prefers (the email itself has both)
  var en = !/^(ru|uk|be|kk)\b/i.test(navigator.language || 'ru');
  var T = en
    ? {
        verifyTitle: 'Email confirmation',
        resetTitle: 'New password',
        pw: 'New password',
        pw2: 'Repeat the password',
        hint: 'At least 8 characters, letters and digits.',
        save: 'Save password',
        back: 'Back to the game',
        privacy: 'Privacy Policy',
        broken: 'The link is incomplete or damaged. Open it from the email in full.',
        confirming: 'Confirming your email…',
        confirmed: 'Email confirmed. Go back to the game and press «I confirmed».',
        tooMany: 'Too many attempts. Wait a minute and open the link again.',
        expired: 'The link is invalid or expired. Ask for a new email in the game (PRIME ID → «Send again»).',
        offline: 'Could not reach the server. Please try again later.',
        short: 'The password needs at least 8 characters.',
        weak: 'Use letters and digits in the password.',
        mismatch: 'The passwords do not match.',
        saving: 'Saving…',
        changed: 'Password changed. Sign in in the game with the new password (PRIME ID → «Sign in»).',
        tooManyShort: 'Too many attempts. Wait a minute.',
        used: 'The link is invalid or already used. Ask for a new one in the game.',
      }
    : {
        verifyTitle: 'Подтверждение email',
        resetTitle: 'Новый пароль',
        pw: 'Новый пароль',
        pw2: 'Повтор пароля',
        hint: 'Минимум 8 символов, буквы и цифры.',
        save: 'Сохранить пароль',
        back: 'Вернуться в игру',
        privacy: 'Политика конфиденциальности',
        broken: 'Ссылка неполная или повреждена. Откройте её из письма целиком.',
        confirming: 'Подтверждаем email…',
        confirmed: 'Email подтверждён. Вернитесь в игру и нажмите «Я подтвердил».',
        tooMany: 'Слишком много попыток. Подождите минуту и откройте ссылку снова.',
        expired: 'Ссылка недействительна или устарела. Запросите новое письмо в игре (PRIME ID → «Отправить ещё раз»).',
        offline: 'Не удалось связаться с сервером. Повторите позже.',
        short: 'Пароль — минимум 8 символов.',
        weak: 'В пароле нужны буквы и цифры.',
        mismatch: 'Пароли не совпадают.',
        saving: 'Сохраняем…',
        changed: 'Пароль изменён. Войдите в игре с новым паролем (PRIME ID → «Войти»).',
        tooManyShort: 'Слишком много попыток. Подождите минуту.',
        used: 'Ссылка недействительна или уже использована. Запросите новую в игре.',
      };
  document.documentElement.lang = en ? 'en' : 'ru';
  var nodes = document.querySelectorAll('[data-t]');
  for (var i = 0; i < nodes.length; i++) nodes[i].textContent = T[nodes[i].getAttribute('data-t')] || nodes[i].textContent;
  document.title = 'PRIME ID — ' + (page === 'verify' ? T.verifyTitle : T.resetTitle);
  var token = '';
  try {
    token = decodeURIComponent((location.hash || '').slice(1));
  } catch (e) {
    token = '';
  }
  if (location.hash) history.replaceState(null, '', location.pathname);

  var $ = function (id) {
    return document.getElementById(id);
  };
  function show(kind, text) {
    var s = $('status');
    s.className = 'status ' + kind;
    s.textContent = text;
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' });
  }

  // «back to the game» — the address comes from the server's own configuration
  fetch('/api/prime/config', { credentials: 'omit' })
    .then(function (r) {
      return r.json();
    })
    .then(function (c) {
      if (c && typeof c.gameUrl === 'string' && /^https?:\/\//.test(c.gameUrl)) {
        $('back').href = c.gameUrl;
        $('back').hidden = false;
        // 1.8.4: the privacy policy of the game, in the page's language
        $('privacy').href = c.gameUrl.replace(/\/*$/, '/') + 'legal/' + (en ? 'en' : 'ru') + '/privacy.html';
        $('privacy').hidden = false;
      }
    })
    .catch(function () {});

  if (!token || token.split('.').length !== 3) {
    show('bad', T.broken);
    if ($('form')) $('form').hidden = true;
    return;
  }

  if (page === 'verify') {
    show('wait', T.confirming);
    post('/api/collections/users/confirm-verification', { token: token })
      .then(function (r) {
        if (r.ok) show('ok', T.confirmed);
        else if (r.status === 429) show('bad', T.tooMany);
        else show('bad', T.expired);
      })
      .catch(function () {
        show('bad', T.offline);
      });
    return;
  }

  // reset
  var busy = false;
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var pw = $('pw').value;
    var pw2 = $('pw2').value;
    if (pw.length < 8) return show('bad', T.short);
    if (!/[A-Za-zА-Яа-яЁё]/.test(pw) || !/[0-9]/.test(pw)) return show('bad', T.weak);
    if (pw !== pw2) return show('bad', T.mismatch);
    busy = true;
    $('submit').disabled = true;
    show('wait', T.saving);
    post('/api/collections/users/confirm-password-reset', { token: token, password: pw, passwordConfirm: pw2 })
      .then(function (r) {
        if (r.ok) {
          $('form').hidden = true;
          show('ok', T.changed);
        } else {
          busy = false;
          $('submit').disabled = false;
          show('bad', r.status === 429 ? T.tooManyShort : T.used);
        }
      })
      .catch(function () {
        busy = false;
        $('submit').disabled = false;
        show('bad', T.offline);
      });
  });
})();
