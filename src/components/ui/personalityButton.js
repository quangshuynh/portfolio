import React from 'react';

export const PERSONALITY_VARIANTS = [
  'rally',
  'mechanical',
  'cat',
  'music',
  'hardware',
  'camera',
  'food',
];

const PERSONALITY_SEED_KEY = 'portfolio-personality-seed';

function createPersonalitySeed() {
  const browserCrypto = typeof window === 'undefined' ? null : window.crypto;
  if (typeof browserCrypto?.randomUUID === 'function') {
    return browserCrypto.randomUUID();
  }
  if (typeof browserCrypto?.getRandomValues === 'function') {
    return Array.from(browserCrypto.getRandomValues(new Uint32Array(2))).join('-');
  }
  return `${Date.now()}-${Math.random()}`;
}

/** Gets one seed per browser tab/session and tolerates unavailable browser storage. */
export function getPersonalitySessionSeed(
  storage = typeof window === 'undefined' ? null : window.sessionStorage,
  generateSeed = createPersonalitySeed,
) {
  try {
    const existingSeed = storage?.getItem(PERSONALITY_SEED_KEY);
    if (existingSeed) return existingSeed;

    const newSeed = generateSeed();
    storage?.setItem(PERSONALITY_SEED_KEY, newSeed);
    return newSeed;
  } catch {
    return generateSeed();
  }
}

export function arePersonalityButtonsEnabled(environment = process.env) {
  return environment.REACT_APP_PERSONALITY_BUTTONS !== 'false';
}

const personalityButtonsEnabled = arePersonalityButtonsEnabled();
const personalitySessionSeed = getPersonalitySessionSeed();

/** Selects a repeatable visual variant from a session seed and stable button key. */
export function personalityForKey(key = '', seed = personalitySessionSeed, adjacentIndex = 0) {
  const hash = Array.from(`${seed}:${String(key)}`).reduce(
    (value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0,
    7,
  );
  return PERSONALITY_VARIANTS[(hash + adjacentIndex) % PERSONALITY_VARIANTS.length];
}

/**
 * Shared CTA primitive. Decoration is presentational; the underlying element keeps
 * native link or button semantics.
 */
function PersonalityButton({
  as: Element,
  children,
  className = '',
  personality = 'none',
  personalityKey,
  personalityIndex = 0,
  secondary = false,
  ...props
}) {
  const Component = Element || (props.href ? 'a' : 'button');
  const resolvedPersonality = personality === 'auto'
    ? personalityForKey(personalityKey || children, personalitySessionSeed, personalityIndex)
    : personality;
  const enabledPersonality = personalityButtonsEnabled && resolvedPersonality !== 'none'
    ? resolvedPersonality
    : undefined;
  const classes = ['button', secondary && 'button-secondary', enabledPersonality && 'personality-button', className]
    .filter(Boolean)
    .join(' ');
  const semanticDefaults = Component === 'button' && !props.type ? { type: 'button' } : {};

  return (
    <Component className={classes} data-personality={enabledPersonality} {...semanticDefaults} {...props}>
      <span className="personality-button__label">{children}</span>
    </Component>
  );
}

export default PersonalityButton;
