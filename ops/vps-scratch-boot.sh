#!/bin/bash
# VPS: scratch boot of iussum-agent under a 250M cgroup cap, one real run, MemAvailable sampled every second. Transient systemd service: systemctl stop ends it for sure.
set -uo pipefail
avail() { awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo; }
echo "gate before boot: MemAvailable $(avail) MB, java $(pgrep -c java || true)"
[ "$(pgrep -c java || true)" = 0 ] && [ "$(avail)" -ge 1500 ] || { echo "GATE FAILED before boot"; exit 3; }
ss -ltn | grep -q ':3040 ' && { echo "port 3040 already in use"; exit 4; }
cd /opt/iussum-agent
systemd-run --quiet --unit=iussum-scratch --collect -p MemoryMax=250M -p MemorySwapMax=0 -p WorkingDirectory=/opt/iussum-agent \
  -E MODEL_PROVIDER=baseten -E MODEL_PROVIDER_SEGMENT=groundsam -E PORT=3040 -E ORIGIN=http://127.0.0.1:3040 -E DATA_DIR=/opt/iussum-agent/data \
  /usr/bin/node --no-warnings --max-old-space-size=200 --env-file=/opt/iussum-agent/.env scripts/serve.mjs
for i in $(seq 1 30); do ss -ltn | grep -q ':3040 ' && break; sleep 1; done
ss -ltn | grep -q ':3040 ' || { echo "server did not start"; journalctl -u iussum-scratch --no-pager | tail -15; systemctl stop iussum-scratch; exit 5; }
echo "server up after boot: MemAvailable $(avail) MB"
CG=/sys/fs/cgroup/system.slice/iussum-scratch.service
: > /tmp/iussum-gate.txt
( while true; do echo "$(date +%s) $(avail) $(cat $CG/memory.current 2>/dev/null) $(pgrep -c java || true)" >> /tmp/iussum-gate.txt; sleep 1; done ) &
SAMPLER=$!
node scripts/run-demo.mjs --base http://127.0.0.1:3040 2>&1 | tail -16
kill $SAMPLER 2>/dev/null
echo "cgroup memory.peak: $(( $(cat $CG/memory.peak 2>/dev/null || echo 0) / 1048576 )) MB (cap 250 MB), memory.events: $(tr '\n' ' ' < $CG/memory.events 2>/dev/null)"
systemctl stop iussum-scratch; sleep 2
ss -ltn | grep -q ':3040 ' && { echo "PORT 3040 STILL UP"; fuser -k 3040/tcp; } || echo "port 3040 free"
systemctl is-active iussum-scratch || true
awk 'NR==1{min=$2;maxc=$3} {if($2<min)min=$2; if($3>maxc)maxc=$3; if($4>j)j=$4; n++} END{printf "samples %d, MemAvailable min %d MB, cgroup memory.current max %d MB, java max %d\n", n, min, maxc/1048576, j}' /tmp/iussum-gate.txt
echo "gate after: MemAvailable $(avail) MB"
