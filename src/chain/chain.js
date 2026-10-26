// Devnet plumbing for this project (own code; the prior repo's demo scripts are not imported): signing keys, the grant transaction, balances.
// The grant is the prior iussum design (ONE transaction, the principal the fee payer and only signer: SPL ApproveChecked for total_cap + one Memo whose
// text is summaryLine(mandate), ending in the mandate id). `@iussum/core`'s createGrantChecker verifies exactly this shape, so it is built to its rules.
import fs from 'node:fs';
import path from 'node:path';
import { createKeyPairSignerFromBytes, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, getSignatureFromTransaction } from '@solana/kit';
import { getApproveCheckedInstruction, getRevokeInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { makeRpc, principalAta, summaryLine } from '@iussum/core';

export const DEVNET = { network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6, facilitator: 'https://facilitator.payai.network' };
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadKeypair(file) {
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(file, 'utf8'))));
}
export async function loadChainKeys(secretsDir) {
  const k = (n) => loadKeypair(path.join(secretsDir, `${n}.json`));
  return { principal: await k('principal'), agent: await k('agent'), float: await k('refund-float') };
}
export function makeChain({ rpcUrl = process.env.DEVNET_RPC || 'https://api.devnet.solana.com' } = {}) {
  const rpc = makeRpc(rpcUrl);
  async function sendTx(feePayer, ixs) {
    const v = (await rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
    const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(feePayer, m), (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: v.blockhash, lastValidBlockHeight: BigInt(v.lastValidBlockHeight) }, m), (m) => appendTransactionMessageInstructions(ixs, m));
    const signed = await signTransactionMessageWithSigners(msg);
    const sig = getSignatureFromTransaction(signed);
    await rpc.call('sendTransaction', [getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    for (let i = 0; i < 60; i++) {
      const s = (await rpc.call('getSignatureStatuses', [[sig]])).value[0];
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') { if (s.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`); return sig; }
      await sleep(1000);
    }
    throw new Error(`transaction ${sig} not confirmed in 60 s`);
  }
  async function sendGrant(principal, mandate) {
    const src = await principalAta(mandate.principal, mandate.asset);
    return sendTx(principal, [
      getApproveCheckedInstruction({ source: src, mint: mandate.asset, delegate: mandate.agent, owner: principal, amount: BigInt(mandate.total_cap), decimals: DEVNET.decimals }, { programAddress: TOKEN_PROGRAM_ADDRESS }),
      { programAddress: MEMO, accounts: [], data: new TextEncoder().encode(summaryLine(mandate)) },
    ]);
  }
  async function sendRevoke(principal, mint = DEVNET.mint) {
    return sendTx(principal, [getRevokeInstruction({ source: await principalAta(principal.address, mint), owner: principal }, { programAddress: TOKEN_PROGRAM_ADDRESS })]);
  }
  // ONLY "the account does not exist" is 0; any other error throws, so a failed read can never look like an empty balance.
  async function usdc(owner) {
    let r;
    try { r = await rpc.call('getTokenAccountBalance', [await principalAta(owner, DEVNET.mint), { commitment: 'confirmed' }]); }
    catch (e) { if (/could not find account|account not found/i.test(e.message)) return 0n; throw e; }
    if (r?.value?.amount === undefined) throw new Error('getTokenAccountBalance returned no amount');
    return BigInt(r.value.amount);
  }
  async function delegation(owner) {
    const info = (await rpc.call('getAccountInfo', [await principalAta(owner, DEVNET.mint), { encoding: 'jsonParsed', commitment: 'confirmed' }]))?.value?.data?.parsed?.info;
    return { delegate: info?.delegate ?? null, amount: BigInt(info?.delegatedAmount?.amount ?? 0) };
  }
  return { rpc, sendTx, sendGrant, sendRevoke, usdc, delegation };
}
export const fmtUsdc = (b) => { const n = BigInt(b); const f = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return `${n / 1_000_000n}${f ? `.${f}` : ''}`; };
export const explorerTx = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
