import type { ActionOption, RoomView } from '../shared/types';
import { SIDE_NAMES } from '../shared/types';

export interface CourtUiState {
  kind: 'aborted' | 'finished' | 'disconnected' | 'generating' | 'resolving' | 'opponent_offline' | 'model_missing' | 'your_turn' | 'opponent_turn';
  title: string; message: string; canAct: boolean; terminal: boolean;
}
export function courtState(room: RoomView, connected: boolean): CourtUiState {
  const game = room.game!, you = room.players.find(p => p.id === room.you)!;
  const state = (kind: CourtUiState['kind'], title: string, message: string, canAct = false, terminal = false): CourtUiState => ({ kind, title, message, canAct, terminal });
  if (room.status === 'cancelled' || game.execution === 'aborted') return state('aborted', '本局已中止', room.notice || '本局已停止，不产生判决。请返回大厅新建房间。', false, true);
  if (room.status === 'finished' || game.phase === 'finished' || game.execution === 'finished') return state('finished', '庭审已结束', `${game.rulesVersion === 3 ? '本局行动机会' : '八次行动'}已经完成，请查看程序判决与关键转折。`, false, true);
  if (!connected) return state('disconnected', '连接中断', '连接中断，正在尝试恢复对局。已确认的行动不会重复结算。');
  const ownTurn = game.turn === you.side;
  if (game.execution === 'generating') return state('generating', ownTurn ? '你的 AI 正在组织辩论' : '对方 AI 正在组织辩论', '本次行动已确认，正在等待律师发言。');
  if (game.execution === 'resolving') return state('resolving', '法庭正在结算', '正在整理本次结果，完成后会交给下一方行动。');
  if (room.players.some(p => !p.connected)) return state('opponent_offline', '等待对方重连', '对方暂时离线，当前案件、回合和已经完成的行动均已保留。');
  if (room.players.some(p => !p.configured)) return state('model_missing', '等待恢复模型连接', you.configured ? '对方的模型密钥尚未恢复，正在等待对方处理。' : '保存的密钥已失效，请重新提交原配置的密钥。');
  return ownTurn ? state('your_turn', '轮到你了：选择一个行动', '选择行动、目标和战术，确认后你的 AI 才会发言。', true) : state('opponent_turn', `等待${SIDE_NAMES[game.turn]}行动`, '等待对方选择行动。你可以继续查看证据和先前的发言。');
}

export function eligibleEvidenceIds(room: RoomView, choice?: ActionOption, targetId = ''): string[] {
  if (!choice?.enabled) return [];
  const authorized = new Set([...room.publicEvidence, ...room.privateEvidence].map(e => e.id));
  const target = room.events.find(e => e.id === targetId);
  return choice.evidenceIds.filter(id => authorized.has(id) && (!choice.targetRequired || choice.actionType === 'cross_examination' || !targetId || target?.action?.cited_evidence_ids.includes(id)));
}
export interface ActionFocus { optionId: string; targetId: string }
