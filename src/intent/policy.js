// Hard limits the CODE enforces whatever a model says. The model proposes; these decide.
export const POLICY = {
  maxTotalUsdc: 20,        // demo ceiling: a request above it is rejected, never clamped
  maxValidHours: 14 * 24,  // two weeks
  minValidHours: 1,
  defaultValidHours: 24,   // used (and shown in the read-back) when the person gives no window
  maxCount: 20,
  defaultCount: 1,
  decimals: 6,             // USDC
};
// Question the person is asked when the model says `clarify`. The wording is ours, never the model's, so exactly one fixed question reaches the person.
export const QUESTIONS = {
  total_cap: 'What is the most, in USDC, the agent may spend in total?',
  shops: 'Which shops may the agent buy from?',
  item: 'What exactly should it buy (for example "a red ceramic mug")?',
  duration: 'For how long should this permission last?',
  amounts: 'Please give the total and the per-purchase maximum as single amounts in USDC.',
};
export const CLARIFY_ORDER = ['total_cap', 'shops', 'item', 'duration', 'amounts']; // when several things are missing, the money question comes first
export const REJECT_MESSAGES = {
  unbounded: 'A spending permission needs a fixed limit. "Whatever it takes" or "no limit" cannot be granted.',
  contradictory: 'The limits contradict each other (a single purchase may not exceed the total).',
  unknown_shop: 'That shop is not one of the demo shops.',
  over_policy: 'The request is beyond what this demo grants (the amount, the window or the number of items is over its limit).',
  out_of_scope: 'This only buys items from the demo shops; it does not send money to wallets or people.',
  invalid_model_output: 'The request could not be turned into limits safely. Nothing was granted.',
};
