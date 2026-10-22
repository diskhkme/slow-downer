import { useEffect, useState } from 'react';

interface Props {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}

/**
 * 직접 입력용 숫자 칸.
 * - 타이핑: 입력 중에는 반영하지 않고 Enter/포커스 해제 시 범위로 잘라 반영
 * - 화살표 버튼/↑↓ 키: 바로 반영
 */
export function NumberField({ value, min, max, step, onCommit }: Props) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (text: string) => {
    const n = Number(text);
    if (text.trim() === '' || Number.isNaN(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      className="number-field"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => {
        // 타이핑은 inputType이 insertText 등으로 채워지고, 화살표 조작은 비어 있다
        const stepped = !(e.nativeEvent as InputEvent).inputType;
        if (stepped) commit(e.target.value);
        else setDraft(e.target.value);
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(draft);
      }}
    />
  );
}
