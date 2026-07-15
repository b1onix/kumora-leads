import React from 'react';

/**
 * Custom icon set — 20px viewBox, 1.6px strokes, round caps, currentColor.
 * Drawn for the Field Survey identity: instruments a surveyor would carry.
 */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
};

/** Compass — the overview. */
export const IconCompass = (p) => (
  <svg {...base} {...p}>
    <circle cx="10" cy="10" r="7.4" />
    <path d="M13 7l-1.8 4.2L7 13l1.8-4.2L13 7z" fill="currentColor" stroke="none" />
  </svg>
);

/** Pin over list rows — the lead ledger. */
export const IconPins = (p) => (
  <svg {...base} {...p}>
    <path d="M7 3.5C5 3.5 3.5 5 3.5 7c0 2.6 3.5 6 3.5 6s3.5-3.4 3.5-6c0-2-1.5-3.5-3.5-3.5z" />
    <circle cx="7" cy="6.9" r="1.1" fill="currentColor" stroke="none" />
    <path d="M13.5 6.5h3M13.5 10h3M7.5 16.5h9" />
  </svg>
);

/** Quill — the AI writer. */
export const IconQuill = (p) => (
  <svg {...base} {...p}>
    <path d="M16.5 3.5c-6 0-10.5 3-12 9.5 3 1.5 8 1 10-2 1.6-2.4 2-5 2-7.5z" />
    <path d="M3.5 16.5c2-4.5 5-7.5 8.5-9.5" />
  </svg>
);

/** Paper plane — review & send. */
export const IconPlane = (p) => (
  <svg {...base} {...p}>
    <path d="M17 3.5L3 9l5 2.2L10.2 16 17 3.5z" />
    <path d="M8 11.2l9-7.7" />
  </svg>
);

/** Sliders — settings. */
export const IconSliders = (p) => (
  <svg {...base} {...p}>
    <path d="M4 6h12M4 10h12M4 14h12" />
    <circle cx="8" cy="6" r="1.7" fill="var(--paper, #fff)" />
    <circle cx="13" cy="10" r="1.7" fill="var(--paper, #fff)" />
    <circle cx="6.5" cy="14" r="1.7" fill="var(--paper, #fff)" />
  </svg>
);

/** Claim tag — billing / plans. */
export const IconTag = (p) => (
  <svg {...base} {...p}>
    <path d="M10.8 3.5H16.5V9.2l-7 7a1.4 1.4 0 01-2 0L3.8 12.5a1.4 1.4 0 010-2l7-7z" />
    <circle cx="13.2" cy="6.8" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);
