// Page logic. All text from the server is inserted with textContent, never as HTML.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); } for (const kid of kids) if (kid) e.append(kid); return e; };
const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j }; };
const show = (id, on = true) => { $(id).hidden = !on; };
const fail = (id, msg) => { const e = $(id); e.textContent = msg; e.hidden = !msg; };
const explain = (j) => j.message ?? (j.error === 'rate_limited' ? `Too many requests. Try again in ${j.retry_after_s} s.` : j.error ?? 'Something went wrong.');
let compileId = null;

(async () => {
  try {
    const s = await (await fetch('/api/status')).json();
    const b = $('banner');
    if (s.dev_stubs) { b.textContent = 'DEV STUBS ACTIVE: no Meta model is being called. This is an engineering build, not the demo.'; b.hidden = false; }
    $('modelNote').textContent = s.dev_stubs ? '' : `Models: compile ${s.providers.compileMandate}, delivery check ${s.providers.segment} + ${s.providers.vision}, shopping agent ${s.providers.agentStep}.`;
  } catch { /* the page still works without the status line */ }
})();

// ---- recording: MediaRecorder -> decode -> 16 kHz mono 16-bit WAV (the format the transcription endpoint documents)
let rec = null, recTimer = null;
async function toWav(blob) {
  const ctx = new AudioContext(), buf = await ctx.decodeAudioData(await blob.arrayBuffer()); await ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000), src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0), out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Uint8Array(out.buffer);
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
$('mic').addEventListener('click', async () => {
  fail('err1', '');
  if (rec) { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      clearTimeout(recTimer); stream.getTracks().forEach((t) => t.stop()); rec = null; $('mic').setAttribute('aria-pressed', 'false'); $('mic').textContent = 'Record (up to 20 s)';
      $('micState').textContent = 'Transcribing…';
      try {
        const r = await post('/api/transcribe', { audio_wav_b64: b64(await toWav(new Blob(chunks))) });
        if (!r.ok) throw new Error(explain(r.j));
        $('req').value = r.j.text; $('micState').textContent = `Heard by ${r.j.model.model}. Check the text, then continue.`;
      } catch (e) { $('micState').textContent = ''; fail('err1', `Transcription failed: ${e.message}`); }
    };
    rec.start(); $('mic').setAttribute('aria-pressed', 'true'); $('mic').textContent = 'Stop'; $('micState').textContent = 'Listening…';
    recTimer = setTimeout(() => rec?.stop(), 20000);
  } catch (e) { fail('err1', `Microphone unavailable: ${e.message}`); }
});

// ---- step 1 -> 2
$('compile').addEventListener('click', async () => {
  fail('err1', ''); show('step3', false); compileId = null;
  $('compile').disabled = true; $('compile').textContent = 'Reading…';
  try {
    const r = await post('/api/compile', { text: $('req').value });
    if (!r.ok) throw new Error(explain(r.j));
    const j = r.j; show('step2'); const rb = $('readback'), cl = $('clarify');
    cl.hidden = true; rb.textContent = ''; $('confirmRow').hidden = true;
    if (j.status === 'mandate') { rb.textContent = j.readback; compileId = j.compile_id; $('confirmRow').hidden = false; }
    else if (j.status === 'clarify') { rb.textContent = 'Nothing was granted.'; cl.textContent = `One question first: ${j.question}`; cl.hidden = false; }
    else { rb.textContent = 'Nothing was granted.'; cl.textContent = j.message; cl.hidden = false; }
    $('step2').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { fail('err1', e.message); }
  finally { $('compile').disabled = false; $('compile').textContent = 'Turn it into limits'; }
});

// ---- step 2 -> 3
const T0 = () => new Date().toLocaleTimeString([], { hour12: false });
const LABEL = {
  grant_start: () => 'Signing the grant on Solana devnet…', grant_done: (e) => ['Grant confirmed on chain', e.url], purchase: (e) => `Paid ${e.shop} for ${e.sku} (${(Number(e.amount) / 1e6).toFixed(2)} USDC)`,
  refused: (e) => `The permission refused a purchase at ${e.shop}: ${e.reason}`, shopping_done: (e) => `Shopping finished (${e.purchases} paid)`, delivery_received: (e) => `Received photo ${e.n} from ${e.shop}`,
  check_start: (e) => `Checking photo ${e.n}: segmentation + vision…`, check_done: (e) => `Photo ${e.n}: ${e.outcome.replaceAll('_', ' ').toLowerCase()}`, dispute_start: (e) => `Filing a dispute for photo ${e.n} with the evidence record…`,
  verdict: (e) => [`Photo ${e.n}: ${e.verdict} (${e.reason}), liable ${e.liable}${e.refund_tx ? ', refund paid' : ''}`, e.refund_url], revoked: (e) => ['Grant revoked', e.url], revoke_failed: (e) => `Could not revoke the grant: ${e.message}`, run_failed: (e) => `Run failed: ${e.message}`,
};
function addLine(e) {
  const f = LABEL[e.type]; if (!f) return;
  const r = f(e), [text, url] = Array.isArray(r) ? r : [r, null];
  const li = el('li', {}, el('time', { text: T0() }), el('span', { text }));
  if (url) { const a = el('a', { href: url, rel: 'noopener', target: '_blank', text: 'explorer' }); li.append(' · ', a); }
  $('timeline').append(li);
}
async function start(check) {
  if (!compileId) return;
  fail('err2', ''); $('confirm').disabled = $('confirmControl').disabled = true;
  const r = await post('/api/confirm', { compile_id: compileId, check_delivery: check });
  if (!r.ok) { fail('err2', explain(r.j)); $('confirm').disabled = $('confirmControl').disabled = false; return; }
  compileId = null; show('step3'); $('timeline').textContent = ''; $('purchases').textContent = ''; show('summary', false);
  $('step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const es = new EventSource(`/api/runs/${r.j.run_id}/events`);
  es.onmessage = async (m) => { const e = JSON.parse(m.data); addLine(e); if (e.type === 'end') { es.close(); await finish(r.j.run_id); $('confirm').disabled = $('confirmControl').disabled = false; } };
  es.onerror = () => { es.close(); };
}
$('confirm').addEventListener('click', () => start(true));
$('confirmControl').addEventListener('click', () => start(false));

async function finish(runId) {
  const rep = await (await fetch(`/api/runs/${runId}`)).json();
  if (!rep.summary) return;
  const s = rep.summary, box = $('summary'); box.textContent = '';
  const cell = (k, v) => box.append(el('div', {}, el('b', { text: v }), el('span', { text: k })));
  cell('photos bought', s.purchased); cell('paid (USDC)', s.paid_usdc);
  if (rep.check_delivery) { cell('caught as wrong', s.not_as_offered); cell('refunded (USDC)', s.refunded_usdc); cell('net loss (USDC)', s.net_loss_usdc); if (s.could_not_be_checked) cell('could not be checked', s.could_not_be_checked); }
  else { cell('checked', '0 (control)'); cell('net loss (USDC)', s.net_loss_usdc); }
  show('summary');
  const list = $('purchases'); list.textContent = '';
  for (const p of rep.purchases) {
    const card = el('div', { class: 'purchase' }, el('h3', {}, `#${p.n} ${p.shop_name} · ${p.sku}`, el('span', { class: `badge ${p.outcome}`, text: (p.outcome ?? '').replaceAll('_', ' ').toLowerCase() })));
    const pair = el('div', { class: 'pair' });
    pair.append(el('figure', {}, el('img', { src: `/runs/${rep.run_id}/${p.image}`, alt: `photo ${p.n} as delivered` }), el('figcaption', { text: 'As delivered' })));
    if (p.overlay) pair.append(el('figure', {}, el('img', { src: `/runs/${rep.run_id}/${p.overlay}`, alt: `photo ${p.n} with the segmentation mask` }), el('figcaption', { text: 'Segmentation mask (magenta) of the object the check looked for' })));
    card.append(pair);
    if (p.outcome_reasons) card.append(el('p', { class: 'muted small', text: p.outcome_reasons.join(' ') }));
    const links = el('p', { class: 'links' });
    if (p.payment_url) links.append(el('a', { href: p.payment_url, rel: 'noopener', target: '_blank', text: 'payment tx' }));
    if (p.verdict?.refund_url) links.append(el('a', { href: p.verdict.refund_url, rel: 'noopener', target: '_blank', text: 'refund tx' }));
    if (p.verdict && p.tx_sig) links.append(el('a', { href: `/v/${p.tx_sig}`, text: 'verdict page' }));
    if (p.evidence) links.append(el('a', { href: `/runs/${rep.run_id}/${p.evidence}`, text: `evidence ${String(p.evidence_id).slice(0, 10)}…` }));
    card.append(links); list.append(card);
  }
}
