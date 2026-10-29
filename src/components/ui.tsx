import { useEffect, useRef, type ReactNode } from 'react';
import type { Catalog, PlayerView } from '../../shared/types';
import { PERSONALITIES, SIDE_NAMES, STRATEGIES } from '../../shared/types';
import { calmBand } from '../../shared/rules';
import { modelName } from '../frontend';

export function Badge({ side }: { side: PlayerView['side'] }) { return <span className={`badge side-${side}`}>{SIDE_NAMES[side]}</span>; }

export function PlayerCard({ player, own, compact = false, catalog, actionStatus }: { player: PlayerView; own: boolean; compact?: boolean; catalog?: Catalog | null; actionStatus?: string }) {
  const stability = player.state?.stability ?? 100;
  return <section className={`panel player-card ${compact ? 'compact' : ''}`}>
    <div className="player-title"><Badge side={player.side} /><h3>{player.nickname}</h3>{own && <span className="subtle-tag">你</span>}{!compact && <span className={`presence ${player.connected ? 'online' : ''}`}>{player.connected ? '在线' : '离线'}</span>}</div>
    {actionStatus && <p className="player-action-status">{actionStatus}</p>}
    {!compact && <p className="model-name">{modelName(player)}</p>}
    {player.state ? <>
      <p className="player-identity">{catalog?.identities.find(i => i.id === player.state?.identity)?.name || '身份'} · 剩余道具 {player.state.items.length - player.state.usedItems.length}</p>
      <div className="stability-label"><span>AI 冷静值 <strong className="numeric">{stability}</strong><span className="muted"> / 100</span></span><span className={stability < 26 ? 'danger-text' : 'muted'}>{calmBand(stability)}</span></div>
      <div className="meter"><span style={{ width: `${stability}%` }} /></div>
      {(player.state.firewall || player.state.preparation > 0 || player.state.extraQuestion) && <p className="player-loadout">{[player.state.firewall && '防火墙保护中', player.state.preparation > 0 && '下次组合证据加强', player.state.extraQuestion && '下次追问免调查'].filter(Boolean).join(' · ')}</p>}
      <details className="loadout-details"><summary>模型与详细状态</summary><p>{modelName(player)}</p><p>连接：{player.connected ? '在线' : '离线'} · 剩余行动 {player.state.actionPoints} · 调查机会 {player.state.investigation}</p><p>{player.state.identity === 'scientist' ? player.state.scientificAnalysisUsed ? '免费复核已用' : '首次技术复核免调查' : '调查机会可用于追问或检查材料'}</p><p>{player.state.items.map(id => `${catalog?.items.find(i => i.id === id)?.name || '道具'}${player.state!.usedItems.includes(id) ? '（已用）' : '（可用）'}`).join('、')}</p></details>
    </> : <><div className="player-detail"><span>{player.config ? `${PERSONALITIES[player.config.personality]} · ${STRATEGIES[player.config.strategy]}` : '等待选择模型、风格和装备'}</span><strong className={player.ready ? 'success-text' : ''}>{player.ready ? '已准备' : player.configured ? '已保存配置' : '未配置'}</strong></div>{catalog && <p className="player-loadout">{catalog.identities.find(i => i.id === player.loadout.identity)?.name} · {player.loadout.items.length ? catalog.items.filter(i => player.loadout.items.includes(i.id)).map(i => i.name).join('、') : '未携带道具'}</p>}</>}
  </section>;
}

export function Field({ name, label, error, hint, children }: { name: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return <div className="field"><label htmlFor={`field-${name}`}>{label}</label>{children}{hint && <p className="field-hint" id={`hint-${name}`}>{hint}</p>}{error && <p className="field-error" id={`error-${name}`}>{error}</p>}</div>;
}
export function fieldProps(name: string, error?: string, hasHint = false) {
  return { id: `field-${name}`, name, 'aria-invalid': !!error, 'aria-describedby': [hasHint ? `hint-${name}` : '', error ? `error-${name}` : ''].filter(Boolean).join(' ') || undefined };
}

export function Dialog({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); close.current(); }}>
    <div className="dialog-title"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}>×</button></div>
    <div className="dialog-body">{children}</div>{actions && <div className="dialog-actions">{actions}</div>}
  </dialog>;
}

export function Rules({ catalog }: { catalog: Catalog | null }) {
  return <div className="rules-copy">
    <h3>十二个行动机会，统一规则判决</h3><p>新局每方六次机会：先各两次调查准备，再各三次交锋，最后各一次陈词。玩家确认后才生成发言；道具占行动。只有无合法目标才会跳过机会，不调用模型。旧版八次行动的记录保留原规则。</p>
    <h3>证据强度与胜负</h3><p>控方证据强度介于 0–100。最终达到案件定罪阈值，控方胜；否则辩方胜。分数是程序规则结果，不代表胜率。AI 不能更改案件事实或自行加分。</p>
    <h3>冷静值和私人情报</h3><p>新局初始90。76～100冷静，51～75承压，26～50不稳定，1～25濒临失控，0严重失控。有效反驳、追问和关键矛盾影响冷静值，不自动恢复；整理思路或咖啡需要消耗行动。低冷静值不直接决定胜负。未选私证不交给模型，也不发给对手。</p>
    <h3>战术、冒险与严重失控</h3><p>强势追问或反驳有效时额外争取2点，自身冷静值-3。冒险在冷静值至少51时成功机会60%，否则40%；有利条件满足并检定成功才额外得4点，失败承受6点压力，不高于50时为8点。0冷静值仍可选择所有合法战术，但辩论另有70%失控：取消有利效果，再反向损失原潜在收益加2、最低6点；30%保持正常思维。调查、检查、恢复及道具不受失控随机惩罚。实际分数仍受0～100限制。所有骰值锁定并记录，重试不重掷。</p><h3>提示模式与案件难度</h3><p>难度决定可选案件及推理复杂度；详细、标准、硬核提示只改变出招前信息量。硬核不返回预测。所有模式结算后都显示真实结果。</p><h3>身份</h3>{catalog?.identities.map(x => <p key={x.id}><strong>{x.name}</strong>：{x.description}</p>)}
    <h3>道具</h3><p>最多携带三种不同道具，每件每局只能成功使用一次。</p>{catalog?.items.map(x => <p key={x.id}><strong>{x.name}</strong>：{x.description}</p>)}
  </div>;
}
