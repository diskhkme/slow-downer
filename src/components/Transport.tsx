import { formatTime } from '../format';

interface Props {
  disabled: boolean;
  playing: boolean;
  position: number;
  duration: number;
  onTogglePlay: () => void;
  onRewind: () => void;
}

/** 파형 바로 아래의 재생 버튼과 현재 시간. 탐색은 파형에서 한다 */
export function Transport(p: Props) {
  return (
    <div className="row">
      <button disabled={p.disabled} onClick={p.onRewind} title="처음으로">
        ⏮
      </button>
      <button disabled={p.disabled} onClick={p.onTogglePlay} title="재생/정지 (Space · Enter)">
        {p.playing ? '⏸' : '▶'}
      </button>
      <span className="time">
        {formatTime(p.position)} <span className="muted">/ {formatTime(p.duration)}</span>
      </span>
    </div>
  );
}
