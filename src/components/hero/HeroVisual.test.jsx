import { act, render, screen } from '@testing-library/react';
import HeroVisual from './HeroVisual';
import Header from '../sections/header';

let intersect, preference, motion, dispose, setActive, load, callbacks;
beforeEach(() => {
  vi.useFakeTimers();
  motion = {
    matches: false,
    addEventListener: vi.fn((_, cb) => {
      preference = cb;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => motion),
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb) {
        intersect = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  // Deterministic timer fallback; browser checks separately cover idle callbacks.
  vi.stubGlobal('requestIdleCallback', undefined);
  dispose = vi.fn();
  setActive = vi.fn();
  load = vi.fn(async () => ({
    mountDeskScene: (_host, options) => {
      callbacks = options;
      return { dispose, setActive };
    },
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete navigator.connection;
});
const enter = async () => {
  await act(async () => {
    intersect([{ isIntersecting: true }]);
    await vi.advanceTimersByTimeAsync(901);
  });
};

test('hero copy, portrait and CTA destinations render before the module loads', () => {
  render(<Header />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'I build reliable backend systems',
  );
  expect(screen.getByRole('link', { name: /View my work/ })).toHaveAttribute(
    'href',
    '#projects',
  );
  expect(screen.getByRole('link', { name: /View résumé/ })).toHaveAttribute(
    'href',
    '/Quang_Huynh_Resume.pdf',
  );
  expect(screen.getByRole('link', { name: 'About Quang' })).toHaveAttribute(
    'href',
    '/about',
  );
});
test('static fallback is immediate, decorative and has a distinct mobile source', () => {
  const { container } = render(<HeroVisual load={load} />);
  expect(container.querySelector('.hero-desk')).toHaveAttribute(
    'data-ready',
    'false',
  );
  expect(container.querySelector('picture img')).toHaveAttribute(
    'width',
    '1000',
  );
  expect(container.querySelector('source')).toHaveAttribute(
    'media',
    '(max-width: 620px)',
  );
  expect(container.querySelector('picture img')).toHaveAttribute('alt', '');
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(screen.queryByText('A little of my world')).not.toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
});
test('loads only after entering the viewport and keeps fallback until the first frame', async () => {
  const { container } = render(<HeroVisual load={load} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(load).not.toHaveBeenCalled();
  await enter();
  expect(load).toHaveBeenCalledTimes(1);
  expect(container.firstChild).toHaveAttribute('data-ready', 'false');
  act(() => callbacks.onReady());
  expect(container.firstChild).toHaveAttribute('data-ready', 'true');
});
test('reduced motion skips all scene loading', async () => {
  motion.matches = true;
  render(<HeroVisual load={load} />);
  await enter();
  expect(load).not.toHaveBeenCalled();
});
test('save-data and slow connections skip scene loading', async () => {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: { saveData: true },
  });
  const first = render(<HeroVisual load={load} />);
  await enter();
  expect(load).not.toHaveBeenCalled();
  first.unmount();
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: { effectiveType: '3g' },
  });
  render(<HeroVisual load={load} />);
  await enter();
  expect(load).not.toHaveBeenCalled();
  delete navigator.connection;
});
test('module download failure retains the fallback without retry storms', async () => {
  load.mockRejectedValue(Error('offline'));
  const { container } = render(<HeroVisual load={load} />);
  await enter();
  await enter();
  expect(load).toHaveBeenCalledTimes(1);
  expect(container.firstChild).toHaveAttribute('data-ready', 'false');
});
test('WebGL initialization failure retains the fallback', async () => {
  load.mockResolvedValue({
    mountDeskScene: (_host, options) => {
      options.onError();
      return { dispose, setActive };
    },
  });
  const { container } = render(<HeroVisual load={load} />);
  await enter();
  expect(container.firstChild).toHaveAttribute('data-ready', 'false');
  expect(dispose).toHaveBeenCalled();
});
test('context failure restores the fallback after a successful frame', async () => {
  const { container } = render(<HeroVisual load={load} />);
  await enter();
  act(() => callbacks.onReady());
  act(() => callbacks.onError());
  expect(container.firstChild).toHaveAttribute('data-ready', 'false');
  expect(dispose).toHaveBeenCalled();
});
test('leaving and returning to the viewport toggles rendering without reimporting', async () => {
  render(<HeroVisual load={load} />);
  await enter();
  act(() => intersect([{ isIntersecting: false }]));
  expect(setActive).toHaveBeenLastCalledWith(false);
  await enter();
  expect(setActive).toHaveBeenLastCalledWith(true);
  expect(load).toHaveBeenCalledTimes(1);
});
test('enabling reduced motion at runtime disposes the renderer', async () => {
  const { container } = render(<HeroVisual load={load} />);
  await enter();
  act(() => callbacks.onReady());
  act(() => {
    motion.matches = true;
    preference();
  });
  expect(dispose).toHaveBeenCalled();
  expect(container.firstChild).toHaveAttribute('data-ready', 'false');
});
test('unmount during import does not initialize a late renderer', async () => {
  let resolve;
  const mount = vi.fn();
  load.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const result = render(<HeroVisual load={load} />);
  await enter();
  result.unmount();
  await act(async () => resolve({ mountDeskScene: mount }));
  expect(mount).not.toHaveBeenCalled();
});
test('browsers without IntersectionObserver retain the static scene', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const { container } = render(<HeroVisual load={load} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(load).not.toHaveBeenCalled();
  expect(container.firstChild).toHaveAttribute('data-ready', 'false');
});

test('fallback selects matching phone, tablet, short-laptop and desktop framing', () => {
  const { container } = render(<HeroVisual load={load} />);
  const sources = [...container.querySelectorAll('picture source')];
  expect(sources.map((source) => [source.media, source.srcset])).toEqual([
    ['(max-width: 620px)', '/hero/desk-mobile.webp'],
    ['(max-width: 1100px)', '/hero/desk-tablet.webp'],
    ['(max-height: 820px)', '/hero/desk-compact.webp'],
  ]);
  expect(container.querySelector('picture img')).toHaveAttribute(
    'src',
    '/hero/desk-desktop.webp',
  );
});
