#!/bin/bash
# 10-minute watch: every 5 s MemAvailable, swap used, service cgroup memory; every 30 s pm2 restart counters of agentfeed*.
OUT=/tmp/meta-watch.txt; : > $OUT
END=$(( $(date +%s) + 600 ))
pm2snap() { pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);console.log(l.length+" "+l.filter(p=>p.pm2_env.status==="online").length+" "+l.reduce((a,p)=>a+p.pm2_env.restart_time,0)+" "+l.filter(p=>/^agentfeed/.test(p.name)).map(p=>p.name+":"+p.pm2_env.restart_time+":"+p.pm_id+":"+p.pm2_env.pm_uptime).join(","))})'; }
echo "PM2 $(date +%s) $(pm2snap)" >> $OUT
i=0
while [ $(date +%s) -lt $END ]; do
  A=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo); SF=$(awk '/SwapFree/{print int($2/1024)}' /proc/meminfo); ST=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
  M=$(( $(cat /sys/fs/cgroup/system.slice/iussum-meta.service/memory.current 2>/dev/null || echo 0) / 1048576 ))
  SW=$(cat /sys/fs/cgroup/system.slice/iussum-meta.service/memory.swap.current 2>/dev/null || echo 0)
  echo "S $(date +%s) avail=$A swapused=$((ST-SF)) svc=$M svcswap=$SW active=$(systemctl is-active iussum-meta) tun=$(systemctl is-active iussum-meta-tunnel)" >> $OUT
  i=$((i+1)); [ $((i % 6)) = 0 ] && echo "PM2 $(date +%s) $(pm2snap)" >> $OUT
  sleep 5
done
echo "PM2 $(date +%s) $(pm2snap)" >> $OUT
echo DONE >> $OUT
