import { act, fireEvent, render, screen } from '@testing-library/react';
import { HomeImageTrigger, HomeLightboxProvider } from './homeLightbox';

test('the image viewer takes focus, closes on Escape, and hands focus back to its trigger', async () => {
  render(
    <HomeLightboxProvider>
      <HomeImageTrigger src="/shot.png" alt="Dashboard screenshot" caption="Dashboard" />
    </HomeLightboxProvider>,
  );
  const trigger = screen.getByRole('button', { name: 'Open image: Dashboard' });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = screen.getByRole('dialog', { name: 'Image viewer: Dashboard' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close image viewer' }));

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(document.activeElement).toBe(trigger);
});
