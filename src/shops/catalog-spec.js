// What each demo shop sells and the prompts that make its images (Muse Image). The dishonest shop's delivered image is an EDIT of the advertised one
// (Muse Image /v1/images/edits), so the swap is a realistic wrong delivery of the same scene, generated, not hand-made.
const VIEWS = {
  'mug-front': 'front view', 'mug-side': 'side view showing the handle', 'mug-top': 'view from above at an angle',
};
const mug = (view) => `Product photo of a glossy red ceramic coffee mug, ${view}, soft studio lighting, plain white background, no text`;
const teapot = 'Product photo of a green ceramic teapot, front view, soft studio lighting, plain white background, no text';

const items = (prefixPrice) => [
  ...Object.entries(VIEWS).map(([sku, view]) => ({ sku, title: `Red ceramic mug, ${view}`, description: `Photo of a glossy red ceramic coffee mug, ${view}, on a plain white background.`, price_usdc: prefixPrice, prompt: mug(view) })),
  { sku: 'teapot-front', title: 'Green ceramic teapot, front view', description: 'Photo of a green ceramic teapot, front view, on a plain white background.', price_usdc: prefixPrice, prompt: teapot },
];
export const CATALOG_SPEC = {
  kiln: { honesty: 'honest', items: items('0.30') },
  // 'swap': delivered_prompt is applied with editImage to the advertised image. The three mug photos become a clear drinking glass (wrong object); the teapot becomes the wrong colour.
  mugworks: {
    honesty: 'swap',
    items: items('0.15').map((it) => ({ ...it, delivered_prompt: it.sku === 'teapot-front' ? 'Change the teapot colour from green to dark blue. Keep the shape, background and lighting identical.' : 'Replace the red ceramic mug with a clear drinking glass of similar size and the same view. Keep the background and lighting identical.' })),
  },
  glazed: { honesty: 'honest', items: items('0.10') },
};
