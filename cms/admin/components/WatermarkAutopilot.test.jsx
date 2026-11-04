import { act, render } from '@testing-library/react';

const portfolio = vi.fn();
const loadPixels = vi.fn();
vi.mock('../api.js', () => ({ imageUrl: (id) => `/api/images/${id}-gallery.jpg`, watermark: { portfolio: (...args) => portfolio(...args) } }));
vi.mock('../watermarkImages.js', () => ({ loadPixels: (...args) => loadPixels(...args), nominalFrame: (width, height) => ({ x: 0, y: 0, width, height }) }));

const { default: WatermarkAutopilot } = await import('./WatermarkAutopilot.jsx');

// A photograph that needs a watermark but has no original attached: it stays a candidate on
// every idle tick and is never drafted.
const overview = (revision = 1) => ({
  preference: { settings: {} },
  photographs: [{ id: 'lake', source: { available: false }, treatment: { revision, watermarkStatus: 'missing', watermarked: false } }],
});
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }); };
let hidden;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  portfolio.mockReset().mockResolvedValue(overview());
  loadPixels.mockReset().mockResolvedValue({ width: 4, height: 4, data: new Uint8ClampedArray(64) });
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => {
  vi.useRealTimers();
  delete document.hidden;
});

test('idle planning decodes each gallery image once per treatment revision and pauses while hidden', async () => {
  render(<WatermarkAutopilot onChanged={() => {}} />);
  await flush();
  expect(portfolio).toHaveBeenCalledTimes(1);
  expect(loadPixels).toHaveBeenCalledTimes(1);

  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();
  }
  expect(portfolio).toHaveBeenCalledTimes(4);
  expect(loadPixels).toHaveBeenCalledTimes(1);

  // A new treatment revision is measured again.
  portfolio.mockResolvedValue(overview(2));
  await act(async () => { vi.advanceTimersByTime(30_000); });
  await flush();
  expect(loadPixels).toHaveBeenCalledTimes(2);

  // A hidden tab does not poll.
  hidden = true;
  await act(async () => { vi.advanceTimersByTime(90_000); });
  await flush();
  expect(portfolio).toHaveBeenCalledTimes(5);
});
