import type { CSSProperties } from 'react';

const paths = {
  whisper: <><path d="M20 11a8 8 0 0 1-8 8H7l-4 3v-6a8 8 0 1 1 17-5Z" /><path d="M8 9h8M8 13h5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  public: <><path d="m4 10 13-5v14L4 14v-4ZM17 9l4-2M18 12h4M17 15l4 2M6 15l2 6h3l-2-5" /></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 4 3 2 3-1 3 3 3-2v-4l3-2-1-4-4-1-1-3H9Z" /><circle cx="11" cy="11" r="3" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
  book: <><path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1v15Z" /></>,
  exit: <><path d="M9 4H4v16h5M10 12h12m-5-5 5 5-5 5" /></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />,
  warning: <><path d="M12 3 2 21h20L12 3ZM12 9v5M12 17v1" /></>,
  sound: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 5.5a9 9 0 0 1 0 13" /></>,
  muted: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="m16 9 5 6m0-6-5 6" /></>,
};
export type IconName = keyof typeof paths;
export default function Icon({ name, size = 20, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}
