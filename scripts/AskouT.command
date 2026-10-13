#!/bin/bash
# Dois cliques neste arquivo (no Finder) sobem o AskouT inteiro. Pode ficar na mesa: ele acha o projeto sozinho.
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run dev:all -- --https
echo; echo "O AskouT foi encerrado. Pode fechar esta janela."
read -r -n 1
