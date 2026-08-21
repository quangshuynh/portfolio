import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

test('renders Quang Huynh’s software engineering portfolio', () => {
  render(<App />);
  expect(screen.getByText('Hi, I’m Quang.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /i build backend, automation, data, and full-stack systems/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Business Data Automation' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Experience' })).toBeInTheDocument();
  expect(screen.getByText(/52 pytest tests/i)).toBeInTheDocument();
  expect(screen.getByText(/firebase authentication and cloud firestore/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Foody live demo' })).toHaveAttribute('href', 'https://foody-rit.web.app/');
  expect(screen.getByRole('link', { name: 'Open GitProfileLens live demo' })).toHaveAttribute('href', 'https://gitprofilelens.vercel.app/');
  const themeToggle = screen.getByRole('button', { name: 'Switch to light mode' });
  fireEvent.click(themeToggle);
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
});
