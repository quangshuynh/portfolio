import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TreatmentReview from './TreatmentReview';
import { treatments } from '../api.js';

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, treatments: { describe: vi.fn(), removeApproved: vi.fn(), approve: vi.fn(), reject: vi.fn(), discard: vi.fn() } };
});

const render_ = { sha256: 'a'.repeat(64), width: 3000, height: 1500 };
const approvedInfo = (overrides = {}) => ({
  photo: { id: 'pier' }, sources: [{ name: 'pier.jpg', kind: 'original' }], staleSource: false, renderFresh: true, approvedLive: true, originalLive: false, original: 'source',
  treatment: { revision: 4, status: 'approved', document: { photos: [{ adjustments: { geometry: { crop: { x: 0, y: 0, width: 0.5, height: 0.5 } } } }] }, render: render_, approved: { render: render_ }, restore: null },
  ...overrides,
});
const record = { id: 'pier', status: 'published' };

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom loads no images: the matched original stays pending, which the test does not need.
});

test('removing an approved treatment asks first, sends the revision and explains what happens', async () => {
  treatments.describe.mockResolvedValue(approvedInfo());
  treatments.removeApproved.mockResolvedValue(approvedInfo({ approvedLive: false, treatment: { ...approvedInfo().treatment, status: 'draft', approved: null, restore: { folder: 'b'.repeat(16) } } }));
  const onNotice = vi.fn();
  render(<TreatmentReview record={record} onNotice={onNotice} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Remove approved treatment…' }));
  expect(treatments.removeApproved).not.toHaveBeenCalled();
  const group = screen.getByRole('group', { name: 'Confirm removing the approved treatment' });
  expect(group).toHaveTextContent(/original appearance at the next publication/);
  expect(group).toHaveTextContent(/Nothing changes on the live site until a publication pull request is merged/);

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('group', { name: 'Confirm removing the approved treatment' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Remove approved treatment…' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove approved treatment' })); });
  expect(treatments.removeApproved).toHaveBeenCalledWith('pier', 4);
  await waitFor(() => expect(screen.getByText(/the original image returns at the next publication/)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /Remove approved treatment/ })).not.toBeInTheDocument();
  expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ tone: 'info' }));
});

test('a stale tab is told to reload and the panel reloads the treatment', async () => {
  treatments.describe.mockResolvedValue(approvedInfo());
  const { ApiError } = await vi.importActual('../api.js');
  treatments.removeApproved.mockRejectedValue(new ApiError(409, { code: 'stale-revision', message: 'The treatment changed in another tab; reload to see the latest version.' }));
  const onNotice = vi.fn();
  render(<TreatmentReview record={record} onNotice={onNotice} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove approved treatment…' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove approved treatment' })); });
  expect(onNotice).toHaveBeenCalledWith({ tone: 'error', text: expect.stringMatching(/another tab/) });
  expect(treatments.describe).toHaveBeenCalledTimes(2);
});

test('the comparison offers split and side by side matched to the edit, and the full-frame original apart', async () => {
  treatments.describe.mockResolvedValue(approvedInfo());
  render(<TreatmentReview record={record} onNotice={() => {}} />);
  const views = await screen.findByRole('group', { name: 'Comparison view' });
  expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('slider', { name: /Split position/ })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/Framing the original like the edit/);

  fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
  expect(screen.getByText('Original, matched to the edit')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Original, full frame' }));
  expect(screen.getByRole('img', { name: 'Original photograph, full frame' })).toHaveAttribute('src', expect.stringContaining('images/original'));
  expect(views).toBeInTheDocument();
  expect(screen.getByText(/Original: the camera original/)).toBeInTheDocument();

  // Enlarged view for checking detail (no Fullscreen API in jsdom: the immersive view).
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' })); });
  expect(document.querySelector('.cms-compare')).toHaveClass('is-fullscreen--immersive');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' })); });
  expect(document.querySelector('.cms-compare')).not.toHaveClass('is-fullscreen');
});
