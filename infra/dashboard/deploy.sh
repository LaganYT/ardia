#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../../apps/dashboard"
. "$here/../lib.sh"

rsync -a --delete --exclude node_modules --exclude dist --exclude .output --exclude .tanstack --exclude src/routeTree.gen.ts "$app/" "$here/app/"
cd "$here"
hexclave_deploy
