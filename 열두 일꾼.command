#!/bin/zsh
set -e
PET_PROJECT_DIR="${0:A:h}"
PET_APP_PATH="$PET_PROJECT_DIR/dist/열두 일꾼-darwin-arm64/열두 일꾼.app"
if [[ -d "$PET_APP_PATH" ]]; then
  open "$PET_APP_PATH"
else
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  cd "$PET_PROJECT_DIR"
  if [[ ! -d node_modules/electron ]]; then
    npm ci
  fi
  npm start
fi
