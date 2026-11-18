import { minimumFor, truncate2 } from '../contrast/color.js';
import type { ContrastSample, Finding, Rule, Severity, Unverified } from '../types.js';
import { capSeverity } from './cap.js';

export interface ContrastOptions {
  level: 'AA' | 'AAA';
  /** Text and form-control values. */
  ratio: Severity;
  placeholder: Severity;
  /** Text whose background couldn't be known. */
  unverified: Severity;
}

/** Short reason for the visual report: `not checked: <label>`. */
export const UNVERIFIED_LABEL: Record<Unverified, string> = {
  image: 'image',
  gradient: 'gradient',
  'gradient text': 'gradient text',
  video: 'video',
  canvas: 'canvas',
  'embedded content': 'embedded content',
  'backdrop-filter': 'backdrop-filter',
  'blend mode': 'blend mode',
  filter: 'filter',
  hidden: 'not hit-testable',
};

const UNVERIFIED_MESSAGE: Record<Unverified, string> = {
  image: 'text over an image',
  gradient: "text over a gradient uilint can't read",
  'gradient text': 'gradient-filled text',
  video: 'text over a video',
  canvas: 'text over a canvas',
  'embedded content': 'text over embedded content',
  'backdrop-filter': 'text over a backdrop-filter',
  'blend mode': 'text with a blend mode',
  filter: 'text under a CSS filter',
  hidden: "text uilint couldn't hit-test",
};

const SUBJECT: Record<ContrastSample['what'], string> = { text: 'text', value: 'input text', placeholder: 'placeholder' };

function message(s: ContrastSample, min: number): string {
  const needs = s.large ? `needs ${min}:1 for large text` : `needs ${min}:1`;
  const colours = s.gradient ? `${s.fg} on ${s.bg}, worst gradient stop` : `${s.fg} on ${s.bg}`;
  return `${SUBJECT[s.what]} contrast ${truncate2(s.ratio)}:1, ${needs} (${colours})`;
}

export const contrast: Rule<ContrastOptions> = {
  name: 'contrast',
  defaults: { level: 'AA', ratio: 'error', placeholder: 'error', unverified: 'warn' },
  check(snapshot, o, ruleSeverity) {
    const findings: Finding[] = [];
    for (const b of snapshot.boxes) {
      const c = b.contrast;
      if (!c) continue;
      let worst: { s: ContrastSample; min: number; score: number } | null = null;
      for (const s of c.samples) {
        const min = minimumFor(o.level, s.large);
        const score = s.ratio / min;
        if (score < 1 && (!worst || score < worst.score)) worst = { s, min, score };
      }
      if (worst) {
        const check = worst.s.what === 'placeholder' ? 'placeholder' : 'ratio';
        const severity = capSeverity(check === 'placeholder' ? o.placeholder : o.ratio, ruleSeverity);
        if (severity) {
          findings.push({
            rule: 'contrast', check, severity, message: message(worst.s, worst.min),
            measured: truncate2(worst.s.ratio), expected: worst.min, boxIds: [b.id], peerIds: [],
          });
        }
        continue;
      }
      if (c.unverified) {
        const severity = capSeverity(o.unverified, ruleSeverity);
        if (severity) {
          findings.push({
            rule: 'contrast', check: 'unverified', severity, message: `${UNVERIFIED_MESSAGE[c.unverified]}, contrast not checked`,
            measured: 0, expected: null, boxIds: [b.id], peerIds: [],
          });
        }
      }
    }
    return findings;
  },
};
