#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [ -x ./runtime/node ]; then
  exec ./runtime/node ./scripts/launch.mjs --portable
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '没有找到运行环境。请使用对应系统的知页便携版，或安装 Node.js 24.5 及更新版本。'
  read -r -p '按回车关闭…'
  exit 1
fi
exec node ./scripts/launch.mjs
