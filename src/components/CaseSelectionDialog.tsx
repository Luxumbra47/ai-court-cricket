import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CaseSummary, Catalog } from '../../shared/types';
import { caseIllustration, courtroomArt } from '../art';

interface Props {
  catalog: Catalog;
  selected: CaseSummary;
  busy: boolean;
  canConfirm: boolean;
  error: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export default function CaseSelectionDialog({ catalog, selected, busy, canConfirm, error, onSelect, onClose, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const imageTimer = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const lastCase = useRef(selected);
  const [previousCase, setPreviousCase] = useState<CaseSummary | null>(null);
  const closeHandler = useRef(onClose); closeHandler.current = onClose;
  const locked = busy || closing;
  const finishClose = () => closeHandler.current();
  const close = () => {
    if (busy || closingRef.current) return;
    closingRef.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finishClose(); return; }
    setClosing(true);
    timer.current = window.setTimeout(finishClose, 280);
  };
  const fallbackImage = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const node = event.currentTarget;
    if (node.dataset.fallback) { node.style.visibility = 'hidden'; return; }
    node.dataset.fallback = 'true'; node.src = courtroomArt.base;
  };

  useEffect(() => {
    const el = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.showModal();
    document.body.classList.add('modal-open');
    const first = el.querySelector<HTMLElement>('[data-case-radio]:checked');
    first?.focus();
    return () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(imageTimer.current);
      if (el.open) el.close();
      document.body.classList.remove('modal-open');
      previous?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (lastCase.current.id === selected.id) return;
    window.clearTimeout(imageTimer.current);
    setPreviousCase(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : lastCase.current);
    lastCase.current = selected;
    imageTimer.current = window.setTimeout(() => setPreviousCase(null), 360);
    return () => window.clearTimeout(imageTimer.current);
  }, [selected.id]);

  useEffect(() => {
    const images = catalog.cases.map(c => { const img = new Image(); img.src = caseIllustration(c); return img; });
    return () => { images.forEach(img => { img.onload = null; img.onerror = null; }); };
  }, [catalog]);

  return <dialog ref={dialog} className={`case-dialog${closing ? ' is-closing' : ''}`} aria-labelledby="case-dialog-title" onCancel={event => { event.preventDefault(); close(); }} onAnimationEnd={event => { if (event.target === event.currentTarget && closingRef.current) finishClose(); }}>
    <header className="case-dialog-head"><div className="case-dialog-title-block"><span className="dossier-kicker">庭审卷宗 · 新建房间</span><h2 id="case-dialog-title">选择本次案件</h2><span className="dossier-divider" aria-hidden="true"><i /></span></div><button className="icon-button" aria-label="关闭对话框" disabled={locked} onClick={close}>×</button></header>
    <div className="case-dialog-content">
      <fieldset className="case-directory" disabled={locked}>
        <legend>案件目录 <span>{String(catalog.cases.length).padStart(2, '0')} 份卷宗</span></legend>
        {catalog.cases.map((c, index) => <label className={`case-option${c.id === selected.id ? ' selected' : ''}`} key={c.id}>
          <input data-case-radio type="radio" name="selected-case" value={c.id} checked={c.id === selected.id} onChange={() => onSelect(c.id)} />
          <span className="case-option-copy"><span className="case-option-titleline"><small className="case-option-number">{String(index + 1).padStart(2, '0')}</small><strong>{c.title}</strong></span><small>{c.subtitle}</small></span>
          <img className="case-option-thumb" src={caseIllustration(c)} alt="" loading="lazy" onError={fallbackImage} />
        </label>)}
      </fieldset>
      <section className="case-detail" aria-live="polite" aria-atomic="true">
        <div className="case-art-stack">
          {previousCase && <img key={`previous-${previousCase.id}`} className="case-art-previous" src={caseIllustration(previousCase)} alt="" aria-hidden="true" />}
          <img key={selected.id} className="case-detail-image" src={caseIllustration(selected)} alt={`${selected.title}案件场景插画`} onError={fallbackImage} />
        </div>
        <div className="case-detail-copy" key={`copy-${selected.id}`}><div className="case-detail-text"><span className="dossier-kicker">当前案卷</span><h3>{selected.title}</h3><p className="case-subtitle">{selected.subtitle}</p><p className="case-background-copy">{selected.background}</p></div>
          <dl className="case-rule-metrics"><div><dt>初始证据强度</dt><dd>{selected.initialScore}</dd></div><div><dt>定罪阈值</dt><dd>{selected.threshold}</dd></div></dl></div>
      </section>
    </div>
    {(error || !canConfirm) && <p className="case-dialog-error" role="alert">{error || '连接已断开，恢复连接后即可创建；也可以返回首页。'}</p>}
    <footer className="case-dialog-footer"><div className="selected-case-summary"><span>当前选择</span><img src={caseIllustration(selected)} alt="" /><span className="selected-case-copy"><strong>{selected.title}</strong><small>{selected.subtitle}</small></span></div><div className="case-dialog-actions"><button className="secondary" type="button" disabled={locked} onClick={close}>返回</button><button className="primary" type="button" disabled={locked || !canConfirm} onClick={onConfirm}>{busy ? '正在创建…' : '确认案件并创建'}<span aria-hidden="true">→</span></button></div></footer>
  </dialog>;
}
