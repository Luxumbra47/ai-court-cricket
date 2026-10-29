import { useEffect, useState } from 'react';
import type { Catalog, PlayerView, Side } from '../../shared/types';
import { PlayerCard } from './ui';
import { courtroomArt } from '../art';

interface Props {
  side: Side;
  player?: PlayerView;
  own: boolean;
  catalog: Catalog | null;
  entranceToken: number;
  readyToken: number;
}

export default function WaitingSeat({ side, player, own, catalog, entranceToken, readyToken }: Props) {
  const sideName = side === 'defense' ? '辩方' : '控方';
  const [entryActive, setEntryActive] = useState(false);
  const [readyActive, setReadyActive] = useState(false);
  useEffect(() => {
    if (!entranceToken) return;
    setEntryActive(true);
    const timer = window.setTimeout(() => setEntryActive(false), 1400);
    return () => window.clearTimeout(timer);
  }, [entranceToken]);
  useEffect(() => {
    if (!readyToken) return;
    setReadyActive(true);
    const timer = window.setTimeout(() => setReadyActive(false), 650);
    return () => window.clearTimeout(timer);
  }, [readyToken]);
  return <div className={`waiting-seat side-${side}${entryActive && player?.connected ? ' seat-arrived' : ''}${player && !player.connected ? ' seat-offline' : ''}`}>
    <div className="seat-visual" aria-hidden="true"><div className="seat-figure" style={{ backgroundImage: `url("${courtroomArt.counsels}")` }} /><span>{sideName}席</span><i /></div>
    {player ? <>
      <PlayerCard player={player} own={own} catalog={catalog} />
      {player.ready && player.connected && <span className={`ready-seal${readyActive ? ' seal-stamped' : ''}`} key={`seal-${player.id}-${readyToken}`} aria-label="已准备">已准备</span>}
      {entryActive && player.connected && <span className="seat-live-note" key={`entry-${player.id}-${entranceToken}`} aria-hidden="true">已入席</span>}
    </> : <div className="empty-seat"><span className="seat-symbol" aria-hidden="true">＋</span><span className="seat-side-label">{sideName}席</span><h3>等待玩家入席</h3><p>朋友输入房间码即可加入。</p></div>}
  </div>;
}
