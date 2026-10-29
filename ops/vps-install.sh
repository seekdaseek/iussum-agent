#!/bin/bash
# VPS: install iussum-agent into its own directory. Touches nothing else.
set -uo pipefail
avail() { awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo; }
echo "gate before install: MemAvailable $(avail) MB, java $(pgrep -c java || true)"
[ "$(pgrep -c java || true)" = 0 ] && [ "$(avail)" -ge 1500 ] || { echo "GATE FAILED, not installing"; exit 3; }
[ -e /opt/iussum-agent ] && { echo "/opt/iussum-agent already exists"; exit 4; }
git clone --quiet --recurse-submodules https://github.com/seekdaseek/iussum-agent /opt/iussum-agent || exit 5
cd /opt/iussum-agent && echo "HEAD $(git rev-parse HEAD)" && git -C prior/iussum rev-parse HEAD
echo "npm ci (capped at 700M, low priority)"
systemd-run --scope -q -p MemoryMax=700M -p MemorySwapMax=0 nice -n 19 npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -8
echo "npm exit ${PIPESTATUS[0]}"
node -e "import('sharp').then(s=>console.log('sharp',s.default.versions.sharp)); import('@iussum/core').then(c=>console.log('core ok', typeof c.validateMandate)); import('node:sqlite').then(()=>console.log('node:sqlite ok'))" 2>&1 | tail -4
echo "gate after install: MemAvailable $(avail) MB"
