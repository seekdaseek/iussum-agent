// Verdict store for delivery disputes (node:sqlite). One row per payment (tx_sig). The refund is claimed with a compare-and-set UPDATE before anything is sent,
// so two disputes, two processes or a retry can never both pay: only the statement that changed the row may send.
import { DatabaseSync } from 'node:sqlite';

export function openDisputeStore(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS verdicts (
    tx_sig TEXT PRIMARY KEY, evidence_id TEXT NOT NULL, outcome TEXT NOT NULL, verdict TEXT NOT NULL, reason TEXT NOT NULL, liable TEXT,
    record_json TEXT NOT NULL, refund_to TEXT, refund_amount TEXT, refund_mint TEXT, refund_decimals INTEGER,
    refund_claim TEXT, refund_pending TEXT, refund_pending_at INTEGER, refund_tx TEXT, created_at INTEGER NOT NULL)`);
  const q = (sql) => db.prepare(sql);
  const get = q('SELECT * FROM verdicts WHERE tx_sig = ?');
  const insert = q('INSERT OR IGNORE INTO verdicts (tx_sig, evidence_id, outcome, verdict, reason, liable, record_json, refund_to, refund_amount, refund_mint, refund_decimals, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const claim = q("UPDATE verdicts SET refund_claim = ?, refund_pending = ?, refund_pending_at = ? WHERE tx_sig = ? AND refund_tx IS NULL AND ((refund_claim IS NULL AND refund_pending IS NULL) OR (refund_pending IS ?))");
  const sign = q('UPDATE verdicts SET refund_pending = ?, refund_pending_at = ? WHERE tx_sig = ? AND refund_claim = ? AND refund_tx IS NULL');
  const done = q('UPDATE verdicts SET refund_tx = ?, refund_claim = NULL, refund_pending = NULL WHERE tx_sig = ?');
  // gives a claim back ONLY while it is still unsigned (pending = the claim marker itself); once a signature is stored it stays, because that transaction may still land
  const release = q('UPDATE verdicts SET refund_claim = NULL, refund_pending = NULL, refund_pending_at = NULL WHERE tx_sig = ? AND refund_claim = ? AND refund_pending = ? AND refund_tx IS NULL');
  return {
    get: (tx) => get.get(tx) ?? null,
    insert: (r) => insert.run(r.tx_sig, r.evidence_id, r.outcome, r.verdict, r.reason, r.liable, r.record_json, r.refund_to ?? null, r.refund_amount ?? null, r.refund_mint ?? null, r.refund_decimals ?? null, r.created_at).changes === 1,
    // takes the right to send: succeeds only when nobody holds a claim, or when the caller names the exact stale pending value it is taking over
    claimRefund: (tx, token, now, over = null) => claim.run(token, `claim:${token}`, now, tx, over).changes === 1,
    signRefund: (tx, token, sig, now) => sign.run(sig, now, tx, token).changes === 1,
    setRefund: (tx, sig) => done.run(sig, tx).changes === 1,
    releaseClaim: (tx, token) => release.run(tx, token, `claim:${token}`).changes === 1,
    all: () => db.prepare('SELECT * FROM verdicts ORDER BY created_at DESC').all(),
    close: () => db.close(),
  };
}
