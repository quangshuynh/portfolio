import React from 'react';
import { expect, test } from 'vitest';
import { render } from '@testing-library/react';
import PhotoThumb from './PhotoThumb';
import { neutralAdjustments } from '../model/adjustments.mjs';

test('an unmounted thumbnail releases its pixels', () => {
  const { container, unmount } = render(<PhotoThumb thumbnail={null} adjustments={neutralAdjustments()} />);
  const canvas = container.querySelector('canvas.pe-thumb');
  Object.assign(canvas, { width: 320, height: 213 });
  unmount();
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
});
