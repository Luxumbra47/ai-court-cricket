import { useEffect, useRef, type ReactNode } from 'react';
import Icon from './Icon';

export default function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog className={`modal${wide ? ' modal-wide' : ''}`} ref={ref} aria-labelledby="modal-heading" onCancel={e => { e.preventDefault(); close.current(); }}>
    <header className="modal-header"><h2 id="modal-heading">{title}</h2><button className="icon-button" aria-label="关闭窗口" onClick={onClose}><Icon name="close" /></button></header>
    <div className="modal-body">{children}</div>
  </dialog>;
}
