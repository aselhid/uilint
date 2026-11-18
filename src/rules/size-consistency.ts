import { chains, rowPairs, stackedPairs } from '../geometry/relations.js';
import { dominant, fmtPx, isNearMiss } from '../near-miss.js';
import type { Box, Finding, Rule } from '../types.js';

export interface SizeOptions { min: number; max: number; maxRatio: number; maxGap: number }

const signature = (b: Box) => `${b.kind}|${b.tag}|${b.role ?? ''}|${b.locator.components[0] ?? ''}`;

export const sizeConsistency: Rule<SizeOptions> = {
  name: 'size-consistency',
  defaults: { min: 0.5, max: 4, maxRatio: 0.25, maxGap: 48 },
  check(snapshot, o, severity) {
    const window = { min: o.min, max: o.max, maxRatio: o.maxRatio };
    const eligible = snapshot.boxes.filter((b) => b.kind !== 'text');
    const findings: Finding[] = [];
    const reported = new Set<string>();
    const sets: { dim: 'height' | 'width'; chain: Box[] }[] = [
      ...chains(rowPairs(eligible, o)).map((chain) => ({ dim: 'height' as const, chain })),
      ...chains(stackedPairs(eligible, o)).map((chain) => ({ dim: 'width' as const, chain })),
    ];
    for (const { dim, chain } of sets) {
      const bySig = new Map<string, Box[]>();
      for (const b of chain) {
        const k = signature(b);
        const list = bySig.get(k);
        if (list) list.push(b);
        else bySig.set(k, [b]);
      }
      for (const members of bySig.values()) {
        if (members.length < 2) continue;
        const size = (b: Box) => b.rect[dim];
        const dom = dominant(members.map(size));
        let flagged: { box: Box; expected: number; peers: Box[] }[] = [];
        if (dom) {
          const matching = members.filter((m) => Math.abs(size(m) - dom.value) <= 0.5);
          flagged = members
            .filter((m) => isNearMiss(size(m), dom.value, window))
            .map((m) => ({ box: m, expected: dom.value, peers: matching }));
        } else if (members.length === 2 && isNearMiss(size(members[1]), size(members[0]), window)) {
          flagged = [{ box: members[1], expected: size(members[0]), peers: [members[0]] }];
        }
        for (const { box, expected, peers } of flagged) {
          const key = `${box.id}:${dim}`;
          if (reported.has(key)) continue;
          reported.add(key);
          findings.push({
            rule: 'size-consistency', check: dim, severity,
            message: `${dim} ${fmtPx(size(box))}, ${peers.length} matching item${peers.length === 1 ? ' is' : 's are'} ${fmtPx(expected)}`,
            measured: size(box), expected, boxIds: [box.id], peerIds: peers.map((p) => p.id),
          });
        }
      }
    }
    return findings;
  },
};
