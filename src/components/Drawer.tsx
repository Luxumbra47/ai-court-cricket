import { useEffect, useId, useRef, type ReactNode } from 'react';
import Icon from './Icon';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** An accessible overlay drawer: Escape, a click on the scrim, and Tab stay inside. */
export default function Drawer({ side, title, badge, onClose, children, bodyClassName = '' }: { side: 'left' | 'right'; title: string; badge?: string; onClose: () => void; children: ReactNode; bodyClassName?: string }) {
  const ref = useRef<HTMLElement>(null);
  const heading = useId();
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    (node?.querySelector<HTMLElement>('[data-drawer-initial]') ?? node?.querySelector<HTMLElement>(FOCUSABLE) ?? node)?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
    if (event.key !== 'Tab') return;
    const node = ref.current; if (!node) return;
    const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(item => item.offsetParent !== null || item === document.activeElement);
    if (!items.length) { event.preventDefault(); node.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <>
    <div className={`drawer-scrim drawer-scrim-${side}`} aria-hidden="true" onClick={() => close.current()} />
    <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={heading} className={`drawer drawer-${side}`} tabIndex={-1} onKeyDown={keyDown}>
      <header className="drawer-header">
        <div><h2 id={heading}>{title}</h2>{badge && <span className="drawer-badge">{badge}</span>}</div>
        <button className="icon-button" aria-label="关闭抽屉" onClick={onClose} data-drawer-initial><Icon name="close" size={18} /></button>
      </header>
      <div className={`drawer-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
    </aside>
  </>;
}
