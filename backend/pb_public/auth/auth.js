// PRIME TIME: SHOWDOWN — Alpha 1.8.2: the pages the email links open (served by PocketBase from
// pb_public, same origin as the API). They replace PocketBase's dashboard pages so the dashboard
// itself (/_/) can stay closed to the internet on a real server.
// The token arrives after «#» (never sent to any server in a request line or a log) and is removed
// from the address bar at once.
(function () {
  'use strict';
  var page = document.body.getAttribute('data-page');
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
      }
    })
    .catch(function () {});

  if (!token || token.split('.').length !== 3) {
    show('bad', 'Ссылка неполная или повреждена. Откройте её из письма целиком.');
    if ($('form')) $('form').hidden = true;
    return;
  }

  if (page === 'verify') {
    show('wait', 'Подтверждаем email…');
    post('/api/collections/users/confirm-verification', { token: token })
      .then(function (r) {
        if (r.ok) show('ok', 'Email подтверждён. Вернитесь в игру и нажмите «Я подтвердил».');
        else if (r.status === 429) show('bad', 'Слишком много попыток. Подождите минуту и откройте ссылку снова.');
        else show('bad', 'Ссылка недействительна или устарела. Запросите новое письмо в игре (PRIME ID → «Отправить ещё раз»).');
      })
      .catch(function () {
        show('bad', 'Не удалось связаться с сервером. Повторите позже.');
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
    if (pw.length < 8) return show('bad', 'Пароль — минимум 8 символов.');
    if (!/[A-Za-zА-Яа-яЁё]/.test(pw) || !/[0-9]/.test(pw)) return show('bad', 'В пароле нужны буквы и цифры.');
    if (pw !== pw2) return show('bad', 'Пароли не совпадают.');
    busy = true;
    $('submit').disabled = true;
    show('wait', 'Сохраняем…');
    post('/api/collections/users/confirm-password-reset', { token: token, password: pw, passwordConfirm: pw2 })
      .then(function (r) {
        if (r.ok) {
          $('form').hidden = true;
          show('ok', 'Пароль изменён. Войдите в игре с новым паролем (PRIME ID → «Войти»).');
        } else {
          busy = false;
          $('submit').disabled = false;
          show('bad', r.status === 429 ? 'Слишком много попыток. Подождите минуту.' : 'Ссылка недействительна или уже использована. Запросите новую в игре.');
        }
      })
      .catch(function () {
        busy = false;
        $('submit').disabled = false;
        show('bad', 'Не удалось связаться с сервером. Повторите позже.');
      });
  });
})();
