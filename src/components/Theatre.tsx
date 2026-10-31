import type { AgentView, MoveKind, Side } from '../../shared/whisper';
import { AGENT_NAMES } from '../../shared/whisper';
import { ACTOR_STATES } from '../../shared/stage';

export function Portrait({ side, large = false }: { side: Side; large?: boolean }) {
  return <span className={`portrait portrait-${side}${large ? ' portrait-large' : ''}`} aria-hidden="true"><span /></span>;
}
export default function Theatre({ agents = [], own, speaking = null, empty = false, compact = false, action, actor, responding = false }: { agents?: AgentView[]; own?: Side; speaking?: Side | null; empty?: boolean; compact?: boolean; action?: MoveKind; actor?: Side; responding?: boolean }) {
  return <div className={`theatre${compact ? ' theatre-compact' : ''}${empty ? ' theatre-empty' : ''}`} aria-label={empty ? '静候入席的双人舞台' : '两位代理人的交锋舞台'}>
    <div className="theatre-backdrop" aria-hidden="true" /><div className="theatre-light" aria-hidden="true" />
    <div className="theatre-table" aria-hidden="true" />
    {!empty && (['a', 'b'] as const).map(side => {
      const agent = agents.find(a => a.side === side);
      return <div key={side} data-pose={actor === side ? action ?? 'speaking' : speaking === side ? 'thinking' : 'listening'} className={`stage-agent stage-agent-${side}${speaking === side || actor === side ? ' is-speaking' : ''}${!agent ? ' is-vacant' : ''}`}>
        <div className="stage-figure" aria-hidden="true" />
        <div className="stage-gesture" aria-hidden="true"><svg viewBox="0 0 100 60"><path d="M5 52 Q35 20 75 26 L93 17 M75 26 L90 31" /></svg></div>
        <div className="stage-name"><span className="stage-side">{side === 'a' ? '甲' : '乙'}</span><strong>{AGENT_NAMES[side]}</strong>{own === side && <span className="own-label">你的代理人</span>}<span className="speaking-label">{actor === side ? action ? ACTOR_STATES[action] : '发言' : speaking === side ? '思考中' : responding ? '等待回应' : '倾听'}</span>{!agent && <span className="muted">等待入席</span>}</div>
      </div>;
    })}
    <div className="theatre-center-mark" aria-hidden="true"><svg width="32" height="48" viewBox="0 0 32 48" fill="none"><path d="M16 1v46M3 16l13-8 13 8-13 8-13-8ZM3 32l13-8 13 8-13 8-13-8Z" stroke="currentColor" /></svg></div>
  </div>;
}
