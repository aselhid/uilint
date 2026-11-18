import { expect, it } from 'vitest';
import { formatJson, formatText, type UrlReport } from '../../src/report/format.js';
import { loc, violation } from '../helpers/violations.js';

const report: UrlReport = {
  url: 'http://localhost:3000/dashboard',
  finalUrl: 'http://localhost:3000/dashboard',
  baselined: 2,
  violations: [
    violation(),
    violation({
      rule: 'spacing', check: 'gap', message: 'gap 14px, siblings use 16px', measured: 14, expected: 16, viewports: [1280], count: 12,
      elements: [loc('li.order-row', 'Order #1042', ['OrderRow'], 'src/orders/OrderRow.tsx:8'), loc('li.order-row', 'Order #1043', ['OrderRow'], 'src/orders/OrderRow.tsx:8')],
      peers: [], peerCount: 0,
    }),
    violation({
      severity: 'warn', rule: 'overflow', check: 'ellipsis', message: 'text truncated with ellipsis', viewports: [375],
      elements: [loc('.customer-email', 'jane.long-name@...', ['CustomerCell'])], peers: [], peerCount: 0,
    }),
  ],
};

it('formats a report exactly', () => {
  expect(formatText([report], [], 50)).toBe(
`uilint  http://localhost:3000/dashboard   2 errors, 1 warning, 2 baselined

error  alignment  left edge 3px off from 4 stacked items  @375,768,1280
  .stat-label "Revenue"  <StatTile>  src/components/StatTile.tsx:12
  aligned with: .card-title "Monthly revenue"  <CardHeader>  (+3 more)

error  spacing  gap 14px, siblings use 16px  @1280  (×12)
  li.order-row "Order #1042"  <OrderRow>  src/orders/OrderRow.tsx:8
  li.order-row "Order #1043"  <OrderRow>  src/orders/OrderRow.tsx:8

warn   overflow  text truncated with ellipsis  @375
  .customer-email "jane.long-name@..."  <CustomerCell>
`);
});

it('says when the page landed elsewhere', () =>
  expect(formatText([{ ...report, finalUrl: 'http://localhost:3000/login?next=%2F' }], [], 50))
    .toMatch(/^uilint  .*\n  note  landed on http:\/\/localhost:3000\/login\?next=%2F\n\n/));

it('says when nothing was found', () =>
  expect(formatText([{ ...report, violations: [], baselined: 0 }], [], 50))
    .toBe('uilint  http://localhost:3000/dashboard   0 errors, 0 warnings\n  no problems found\n'));

it('caps output and says how many were hidden', () => {
  const many = { ...report, violations: Array.from({ length: 60 }, () => violation()) };
  const out = formatText([many], [], 50);
  expect(out.match(/^error  /gm)).toHaveLength(50);
  expect(out).toMatch(/^… 10 more not shown \(use --max\)$/m);
});

it('prints run notes last', () =>
  expect(formatText([report], ['ignore entry unused: uilint.ignore:3'], 50)).toMatch(/\nnote  ignore entry unused: uilint.ignore:3\n$/));

it('emits JSON with the same violations', () => {
  const j = JSON.parse(formatJson([report], ['n']));
  expect(j.version).toBe(1);
  expect(j.reports[0].violations).toHaveLength(report.violations.length);
  expect(j.notes).toEqual(['n']);
});
