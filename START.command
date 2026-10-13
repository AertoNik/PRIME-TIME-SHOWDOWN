#!/bin/zsh
set -e
cd "${0:A:h}"

# Use a regular Node installation, or the Node runtime bundled with Codex.
if command -v node >/dev/null 2>&1; then
  game_node="$(command -v node)"
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  game_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  print 'Для запуска нужен Node.js 20.19+ или 22.12+. Установите Node.js, затем повторите.'
  read -r '?Нажмите Enter, чтобы закрыть окно.'
  exit 1
fi

if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  if command -v npm >/dev/null 2>&1; then
    npm install
  else
    print 'Зависимости отсутствуют. Установите Node.js с npm и выполните npm install.'
    read -r '?Нажмите Enter, чтобы закрыть окно.'
    exit 1
  fi
fi
print 'PRIME TIME: SHOWDOWN — http://localhost:5173'
print 'Для остановки нажмите Control+C. Для телефона используйте Network-адрес ниже.'
open 'http://localhost:5173/'
exec "$game_node" node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort
