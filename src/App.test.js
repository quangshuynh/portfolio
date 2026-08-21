import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

test('renders Quang Huynh’s software engineering portfolio', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /i build software that solves practical problems/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Business Data Automation' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Experience' })).toBeInTheDocument();
  const themeToggle = screen.getByRole('button', { name: 'Switch to light mode' });
  fireEvent.click(themeToggle);
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
});
