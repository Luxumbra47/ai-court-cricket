import { z } from 'zod';
const items = ['magnifier', 'coffee', 'archive', 'interrogate', 'firewall', 'extension'] as const;
export const actionSchema = z.object({ speech: z.string().trim().min(1).max(800),
  action_type: z.enum(['challenge_evidence', 'timeline_analysis', 'counter_argument', 'present_evidence', 'cross_examination', 'closing_statement', 'use_item', 'review_evidence', 'investigate_lead', 'regain_composure']),
  cited_evidence_ids: z.array(z.string().regex(/^[A-Z][0-9]{2}$/)).max(3).refine(a => new Set(a).size === a.length),
  target_argument_id: z.string().max(100).nullable(), item_id: z.enum(items).nullable(), tone: z.string().trim().min(1).max(40),
}).strict();
export const commandSchema = z.object({ actionId: z.string().uuid(), turnId: z.string().min(1).max(100), optionId: z.string().min(1).max(80),
  previewId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  evidenceIds: z.array(z.string().regex(/^[A-Z][0-9]{2}$/)).max(3).refine(a => new Set(a).size === a.length),
  leadIds: z.array(z.string().min(1).max(80)).max(2).refine(a => new Set(a).size === a.length).optional(),
  targetArgumentId: z.string().max(100).nullable(), itemId: z.enum(items).nullable(),
  tactic: z.enum(['steady', 'assertive', 'risky', 'logical_summary', 'evidence_rebuttal', 'forceful_closing', 'risky_closing']),
}).strict().transform(c => ({ ...c, evidenceIds: [...c.evidenceIds].sort(), ...(c.leadIds ? { leadIds: [...c.leadIds].sort() } : {}) }));
