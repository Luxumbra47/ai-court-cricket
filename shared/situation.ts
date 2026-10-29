import type { Side } from './types.js';
export function situation(score: number, threshold: number, turn: Side, side: Side) {
  const gap = threshold - score;
  const position = gap > 0 ? `控方还差 ${gap} 点达到胜诉阈值。` : `控方已${gap === 0 ? '刚好达到' : `超过阈值 ${-gap} 点`}。`;
  return { score, threshold, turn, gap, text: position + (side === 'defense' ? '可围绕证据疑点和对方论点组织辩护。' : '可通过出示材料、追问和组合证据支持指控。') };
}
