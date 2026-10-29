import type { ActionPreview as Preview } from '../../shared/types';
import { MATCH_MODES } from '../../shared/types';
const signed = (n: number) => n > 0 ? `+${n}` : `${n}`;
const range = ([a, b]: [number, number]) => a === b ? signed(a) : `${signed(a)} 至 ${signed(b)}`;
export default function ActionPreview({ preview }: { preview: Preview }) {
  const f = preview.forecast;
  return <div className="dynamic-preview" aria-label="行动预览" data-mode={preview.mode}>
    <strong>{MATCH_MODES[preview.mode].label} · {f ? f.certainty === 'certain' ? '可确定效果' : '条件效果' : '行动说明'}</strong>
    <p>{preview.purpose}</p><p>{preview.costs.join(' ')}</p>
    <details><summary>必要条件</summary>{preview.requirements.map(line => <p key={line}>{line}</p>)}</details>
    {f && <><p>{f.direction}</p>{f.score && <div className="preview-numbers"><span>控方证据强度：{range(f.score)}</span><span>本方冷静值：{range(f.selfCalm!)}</span><span>对方冷静值：{range(f.opponentCalm!)}</span></div>}
      {f.probability !== undefined && <p>材料满足条件时，冒险检定成功机会 {f.probability}%。</p>}
      {f.meltdownProbability !== undefined && <p>严重失控机会 {f.meltdownProbability}%，其余保持正常思维；仅影响辩论行动。</p>}
      {f.conditions.map(line => <p key={line}>{line}</p>)}{f.risks.map(line => <p className="preview-risk" key={line}>{line}</p>)}{f.note && <p className="field-hint">{f.note}</p>}</>}
    {!!preview.disclosure.length && <p className="private-disclosure">本次将公开「{preview.disclosure.join('、')}」，失败也不会收回。</p>}
  </div>;
}
