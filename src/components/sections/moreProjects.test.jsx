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
