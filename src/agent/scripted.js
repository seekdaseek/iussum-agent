// TEST DOUBLE. A deterministic stand-in for provider.agentStep: it reads the tool results already in the conversation and picks the cheapest catalogue
// items from the allowed shops whose title matches the noun phrase. It exists so the loop, the purchase path and the pipeline can be exercised offline and so
// tests do not depend on a model's choices. It is never used in the demo or the video, and its steps carry meta.provider 'scripted'.
export function scriptedProvider({ allowedShopIds, noun_phrase, count }) {
  const words = noun_phrase.toLowerCase().split(/\s+/);
  return {
    async agentStep(messages) {
      const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
      const catalogs = results.filter((r) => r.catalog).map((r) => r.catalog);
      const call = (name, args) => ({ value: { content: '', tool_calls: [{ id: `s${messages.length}`, name, arguments: args }], finish_reason: 'tool_calls' }, meta: { provider: 'scripted', model: 'scripted', job: 'agentStep' } });
      if (!results.some((r) => r.shops)) return call('list_shops', {});
      const seen = new Set(catalogs.map((c) => c.id));
      const next = allowedShopIds.find((id) => !seen.has(id));
      if (next) return call('get_catalog', { shop_id: next });
      const boughtN = results.filter((r) => r.paid).length;
      if (boughtN >= count) return call('finish', { summary: 'bought what was asked' });
      const tried = new Set(messages.filter((m) => m.role === 'assistant').flatMap((m) => m.tool_calls ?? []).filter((t) => t.function.name === 'buy_photo').map((t) => t.function.arguments));
      const offers = catalogs.flatMap((c) => c.items.filter((i) => words.every((w) => i.title.toLowerCase().includes(w))).map((i) => ({ shop_id: c.id, sku: i.sku, price: BigInt(i.price) })))
        .filter((o) => !tried.has(JSON.stringify({ shop_id: o.shop_id, sku: o.sku }))).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
      if (!offers.length) return call('finish', { summary: 'no more matching offers' });
      return call('buy_photo', { shop_id: offers[0].shop_id, sku: offers[0].sku });
    },
  };
}
