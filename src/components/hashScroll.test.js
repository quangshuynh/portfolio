import { fireEvent, render, screen } from '@testing-library/react';
import App from '../App';

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function navigateFromAbout(hash) {
  window.history.replaceState({}, '', '/about');
  const view = render(<App />);
  expect(screen.getByRole('heading', { name: 'Beyond software' })).toBeInTheDocument();

  view.unmount();
  window.history.pushState({}, '', `/${hash}`);
  render(<App />);
}

test('scrolls to Projects after navigating from About to the homepage hash', () => {
  navigateFromAbout('#projects');

  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  expect(Element.prototype.scrollIntoView.mock.instances[0]).toHaveAttribute('id', 'projects');
});

test('scrolls to another homepage section after navigating from About', () => {
  navigateFromAbout('#contact');

  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  expect(Element.prototype.scrollIntoView.mock.instances[0]).toHaveAttribute('id', 'contact');
});

test('a homepage URL without a hash keeps the normal top-of-page behavior', () => {
  render(<App />);

  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

test('same-page hash links retain native anchor navigation', () => {
  render(<App />);
  const link = screen.getByRole('link', { name: 'View my work' });

  expect(link).toHaveAttribute('href', '#projects');
  expect(screen.getByRole('region', { name: 'Featured projects' })).toBeInTheDocument();
  fireEvent.click(link);
});

test('a nonexistent homepage hash is ignored without errors', () => {
  window.history.replaceState({}, '', '/#does-not-exist');

  expect(() => render(<App />)).not.toThrow();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});
