import { act, fireEvent, render, screen } from '@testing-library/react';

const portfolio = vi.fn();
const loadPixels = vi.fn();
vi.mock('../api.js', () => ({ imageUrl: (id) => `/api/images/${id}-gallery.jpg`, watermark: { portfolio: (...args) => portfolio(...args) } }));
vi.mock('../watermarkImages.js', () => ({ loadPixels: (...args) => loadPixels(...args), nominalFrame: (width, height) => ({ x: 0, y: 0, width, height }) }));

const { default: WatermarkAutopilot } = await import('./WatermarkAutopilot.jsx');
const { QUEUE_DONE_MESSAGE, WATERMARK_QUEUE_KEY } = await import('../editorHost.jsx');

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

test('Stop finishes the current photograph and plans nothing more until a reload', async () => {
  localStorage.setItem(WATERMARK_QUEUE_KEY, JSON.stringify({ mode: 'auto', ids: ['first', 'second'], settings: {}, index: 0, results: [] }));
  render(<WatermarkAutopilot onChanged={() => {}} />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  // The frame finishes the first photograph and reports the stopped queue done.
  localStorage.setItem(WATERMARK_QUEUE_KEY, JSON.stringify({ mode: 'auto', ids: ['first', 'second'], settings: {}, index: 1, results: [{ id: 'first', outcome: 'drafted' }], stopped: true }));
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data: { type: QUEUE_DONE_MESSAGE } })); });
  await flush();
  await act(async () => { vi.advanceTimersByTime(120_000); });
  await flush();
  expect(portfolio).not.toHaveBeenCalled();
  expect(document.querySelector('iframe')).toBeNull();
});
