import { useEffect, useRef } from 'react';
import type { TrackSettings as Settings } from '../store/types';
import { NumberField } from './NumberField';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

/** 가운데 0이 있는 슬라이더는 더블클릭으로 0 */
function Slider({ value, min, max, step, onChange }: SliderProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onDoubleClick={() => min < 0 && max > 0 && onChange(0)}
    />
  );
}

interface RowProps extends SliderProps {
  label: string;
  unit: string;
}

function SliderRow({ label, unit, ...slider }: RowProps) {
  return (
    <div className="row">
      <label>{label}</label>
      <Slider {...slider} />
      <NumberField {...slider} onCommit={slider.onChange} />
      <span className="unit">{unit}</span>
    </div>
  );
}

/** EQ 한 밴드: 위에 이름과 값, 아래에 슬라이더 */
function EqBand({ label, ...slider }: SliderProps & { label: string }) {
  return (
    <div className="eq-band">
      <div className="eq-head">
        <span className="muted">{label}</span>
        <NumberField {...slider} onCommit={slider.onChange} />
      </div>
      <Slider {...slider} />
    </div>
  );
}

interface Props {
  settings: Settings;
  autoGainDb: number;
  onChange: (patch: Partial<Settings>) => void;
}

const THUMB_PX = 16; // Chromium 기본 슬라이더 손잡이 폭 (클릭이 손잡이 위인지 판단용)

interface StepSliderProps {
  value: number;
  min: number;
  max: number;
  coarse: number; // 큰 단위 (클릭/드래그)
  onChange: (value: number) => void;
}

/**
 * 큰 단위로 움직이는 슬라이더.
 * - 빈 곳 클릭: 그 위치로 점프하지 않고 그쪽으로 한 칸 (칸 사이 값이면 가까운 칸으로)
 * - 손잡이 드래그: 칸에 맞춰 움직임
 * - 키보드 ←/→: 1 단위 (미세 조정)
 */
function StepSlider({ value, min, max, coarse, onChange }: StepSliderProps) {
  const grid = [min];
  for (let v = Math.floor(min / coarse + 1) * coarse; v < max; v += coarse) if (v > min) grid.push(v);
  grid.push(max);
  const up = grid.find((v) => v > value) ?? max;
  const down = [...grid].reverse().find((v) => v < value) ?? min;
  const snap = (v: number) => grid.reduce((best, g) => (Math.abs(g - v) < Math.abs(best - v) ? g : best));

  const dragging = useRef(false);
  useEffect(() => {
    const end = () => (dragging.current = false);
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const thumbX = rect.left + THUMB_PX / 2 + ((value - min) / (max - min)) * (rect.width - THUMB_PX);
    if (Math.abs(e.clientX - thumbX) <= THUMB_PX / 2 + 2) {
      dragging.current = true; // 손잡이: 기본 드래그에 맡기고 onChange에서 칸에 맞춘다
      return;
    }
    e.preventDefault(); // 클릭 위치로 점프하는 기본 동작 막기
    onChange(e.clientX < thumbX ? down : up);
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={1}
      value={value}
      onPointerDown={onPointerDown}
      onMouseDown={(e) => !dragging.current && e.preventDefault()}
      onChange={(e) => {
        const v = Number(e.target.value);
        onChange(dragging.current ? snap(v) : v);
      }}
    />
  );
}

interface StepRowProps extends StepSliderProps {
  label: string;
  unit: string;
  fine?: boolean; // 1 단위 −/+ 버튼
}

function StepRow({ label, unit, fine, ...slider }: StepRowProps) {
  const { value, min, max, onChange } = slider;
  const nudge = (d: number) => onChange(Math.max(min, Math.min(max, value + d)));
  return (
    <div className="step-row">
      <label>{label}</label>
      <StepSlider {...slider} />
      {fine ? (
        <button className="fine" title={`-1${unit}`} onClick={() => nudge(-1)}>
          −
        </button>
      ) : (
        <span />
      )}
      <NumberField value={value} min={min} max={max} step={1} onCommit={onChange} />
      {fine ? (
        <button className="fine" title={`+1${unit}`} onClick={() => nudge(1)}>
          +
        </button>
      ) : (
        <span />
      )}
      <span className="unit">{unit}</span>
    </div>
  );
}

export function SpeedPitchPanel({ settings: s, onChange }: Omit<Props, 'autoGainDb'>) {
  return (
    <section className="panel">
      <div className="panel-title">
        속도 · 피치
        <span className="hint">클릭: 한 칸씩 · −/+: 1%</span>
      </div>
      <StepRow
        label="속도"
        value={Math.round(s.tempo * 100)}
        min={25}
        max={150}
        coarse={10}
        unit="%"
        fine
        onChange={(pct) => onChange({ tempo: pct / 100 })}
      />
      <StepRow
        label="피치"
        value={s.pitch}
        min={-12}
        max={12}
        coarse={1}
        unit="반음"
        onChange={(pitch) => onChange({ pitch })}
      />
    </section>
  );
}

export function VolumePanel({ settings: s, autoGainDb, onChange }: Props) {
  const eq = (band: 'low' | 'mid' | 'high') => (db: number) => onChange({ eq: { ...s.eq, [band]: db } });
  return (
    <section className="panel">
      <div className="panel-title">
        음량
        <span className="hint" title="곡 간 음량 평준화 (-14 LUFS 기준)">
          자동 보정 {autoGainDb >= 0 ? '+' : ''}
          {autoGainDb.toFixed(1)} dB
        </span>
      </div>
      <SliderRow
        label="볼륨"
        value={s.gainOffsetDb}
        min={-12}
        max={12}
        step={0.5}
        unit="dB"
        onChange={(gainOffsetDb) => onChange({ gainOffsetDb })}
      />
      <div className="eq">
        <EqBand label="저음" value={s.eq.low} min={-12} max={12} step={0.5} onChange={eq('low')} />
        <EqBand label="중음" value={s.eq.mid} min={-12} max={12} step={0.5} onChange={eq('mid')} />
        <EqBand label="고음" value={s.eq.high} min={-12} max={12} step={0.5} onChange={eq('high')} />
      </div>
    </section>
  );
}
