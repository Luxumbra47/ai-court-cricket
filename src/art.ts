import type { CaseSummary } from '../shared/types';

export const courtroomArt = {
  base: '/art/dark/courtroom-base.webp',
  foreground: '/art/dark/courtroom-foreground.webp',
  counsels: '/art/dark/courtroom-counsels.webp',
} as const;

const caseArtById: Record<string, string> = {
  'pizza-001': '/art/dark/case-pizza.webp',
  'diamond-002': '/art/dark/case-diamond.webp',
  'robot-003': '/art/dark/case-robot.webp',
};

export function caseIllustration(c: CaseSummary) {
  return caseArtById[c.id] || courtroomArt.base;
}
