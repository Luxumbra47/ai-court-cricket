import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { courtroomArt } from '../art';

export default function CourtroomBackdrop({ paused }: { paused: boolean }) {
  const scene = useRef<HTMLDivElement>(null);
  const [environment, setEnvironment] = useState({ visible: false, fine: false });
  const active = environment.visible && !paused;

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setEnvironment({ visible: !document.hidden && !reduced.matches, fine: finePointer.matches });
    update();
    reduced.addEventListener('change', update);
    finePointer.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      reduced.removeEventListener('change', update);
      finePointer.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  useEffect(() => {
    const node = scene.current;
    if (!node || !active || !environment.fine) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const move = (event: PointerEvent) => {
      x = (event.clientX / window.innerWidth - 0.5) * 2;
      y = (event.clientY / window.innerHeight - 0.5) * 2;
      if (!frame) frame = requestAnimationFrame(() => {
        node.style.setProperty('--scene-x', `${x * 10}px`);
        node.style.setProperty('--scene-y', `${y * 6}px`);
        frame = 0;
      });
    };
    const leave = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      node.style.setProperty('--scene-x', '0px');
      node.style.setProperty('--scene-y', '0px');
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', leave);
      if (frame) cancelAnimationFrame(frame);
      leave();
    };
  }, [active, environment.fine]);

  return <div ref={scene} aria-hidden="true" className={`courtroom-backdrop${active ? ' motion-active' : ''}${paused ? ' is-paused' : ''}`}>
    <img className="courtroom-base" src={courtroomArt.base} alt="" />
    <div className="courtroom-light" />
    <div className="courtroom-dust" />
    <div className="courtroom-holograms" style={{ '--counsel-image': `url("${courtroomArt.counsels}")` } as CSSProperties}>
      <img className="courtroom-counsels" src={courtroomArt.counsels} alt="" />
      <div className="courtroom-scan" />
    </div>
    <img className="courtroom-foreground" src={courtroomArt.foreground} alt="" />
  </div>;
}
