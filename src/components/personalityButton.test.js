import { render, screen } from '@testing-library/react';
import PersonalityButton, {
  arePersonalityButtonsEnabled,
  getPersonalitySessionSeed,
  PERSONALITY_VARIANTS,
  personalityForKey,
} from './personalityButton';

test('the same session seed produces a stable approved mapping', () => {
  const first = personalityForKey('project-live-demo', 'session-one');
  expect(PERSONALITY_VARIANTS).toContain(first);
  expect(personalityForKey('project-live-demo', 'session-one')).toBe(first);
});

test('different session seeds produce different button combinations', () => {
  const keys = ['view-work', 'architecture', 'documentation', 'more-projects'];
  const firstSession = keys.map((key) => personalityForKey(key, 'session-one'));
  const secondSession = keys.map((key) => personalityForKey(key, 'session-two'));
  expect(secondSession).not.toEqual(firstSession);
});

test('reuses a stored session seed and only generates one when missing', () => {
  const values = new Map();
  const storage = {
    getItem: jest.fn((key) => values.get(key) || null),
    setItem: jest.fn((key, value) => values.set(key, value)),
  };
  const generateSeed = jest.fn(() => 'generated-seed');

  expect(getPersonalitySessionSeed(storage, generateSeed)).toBe('generated-seed');
  expect(getPersonalitySessionSeed(storage, generateSeed)).toBe('generated-seed');
  expect(generateSeed).toHaveBeenCalledTimes(1);
});

test('adjacent indexes avoid an obvious run of duplicate themes', () => {
  const themes = [0, 1, 2].map((index) => personalityForKey('project-actions', 'session', index));
  expect(new Set(themes).size).toBe(3);
});

test('the global environment switch can disable personality styling', () => {
  expect(arePersonalityButtonsEnabled({ REACT_APP_PERSONALITY_BUTTONS: 'false' })).toBe(false);
  expect(arePersonalityButtonsEnabled({})).toBe(true);
});

test('keeps native link and button semantics while decoration stays in CSS', () => {
  const { rerender } = render(
    <PersonalityButton href="/demo" personality="auto" personalityKey="demo">Live demo</PersonalityButton>,
  );
  const link = screen.getByRole('link', { name: 'Live demo' });
  expect(link).toHaveAttribute('href', '/demo');
  const initialPersonality = link.getAttribute('data-personality');
  expect(PERSONALITY_VARIANTS).toContain(initialPersonality);

  rerender(
    <PersonalityButton href="/demo" personality="auto" personalityKey="demo">Live demo</PersonalityButton>,
  );
  expect(screen.getByRole('link', { name: 'Live demo' })).toHaveAttribute('data-personality', initialPersonality);

  rerender(<PersonalityButton personality="camera" onClick={() => {}}>Learn more</PersonalityButton>);
  expect(screen.getByRole('button', { name: 'Learn more' })).toHaveAttribute('data-personality', 'camera');
  expect(screen.getByRole('button', { name: 'Learn more' })).toHaveAttribute('type', 'button');
});
