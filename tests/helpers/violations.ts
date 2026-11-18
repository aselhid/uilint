import type { Locator, Violation } from '../../src/types.js';

export const loc = (selector: string, text: string | null = null, components: string[] = [], source: string | null = null): Locator =>
  ({ selector, text, components, source });

export function violation(o: Partial<Violation> = {}): Violation {
  return {
    url: 'http://localhost:3000/dashboard',
    rule: 'alignment',
    check: 'left',
    severity: 'error',
    message: 'left edge 3px off from 4 stacked items',
    measured: 3,
    expected: 0,
    elements: [loc('.stat-label', 'Revenue', ['StatTile'], 'src/components/StatTile.tsx:12')],
    peers: [loc('.card-title', 'Monthly revenue', ['CardHeader'])],
    peerCount: 4,
    viewports: [375, 768, 1280],
    count: 1,
    fingerprint: 'abc',
    anchor: { y: 0, x: 0 },
    ...o,
  };
}
