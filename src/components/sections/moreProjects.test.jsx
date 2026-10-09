import { fireEvent, render, screen } from '@testing-library/react';
import MoreProjects from './moreProjects';

test('expanding moves focus to the first newly shown project; collapsing returns it to the toggle', () => {
  render(<MoreProjects />);
  const toggle = screen.getByRole('button', { name: 'View more projects' });
  expect(screen.getAllByRole('article')).toHaveLength(3);

  toggle.focus();
  fireEvent.click(toggle);
  expect(screen.getAllByRole('article')).toHaveLength(8);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Chessed' }));

  fireEvent.click(screen.getByRole('button', { name: 'Show fewer projects' }));
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View more projects' }));
});

test('collapsing while focus is inside a project being hidden returns focus to the toggle', () => {
  render(<MoreProjects />);
  fireEvent.click(screen.getByRole('button', { name: 'View more projects' }));
  const hiddenLink = screen.getByRole('link', { name: 'Open SalonFlow repository' });
  hiddenLink.focus();
  // A click that does not move focus first (Safari does not focus buttons on click).
  fireEvent.click(screen.getByRole('button', { name: 'Show fewer projects' }));
  expect(hiddenLink).not.toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View more projects' }));
});
