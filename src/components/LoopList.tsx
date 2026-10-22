import { useState } from 'react';
import type { Loop } from '../store/types';
import { formatLoopTime } from '../format';

interface Props {
  loops: Loop[];
  activeId: string | null;
  enabled: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggle: () => void;
}

export function LoopList({ loops, activeId, enabled, onSelect, onRename, onDelete, onToggle }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  return (
    <section className="panel loops">
      <div className="panel-title">
        루프
        <button className={enabled ? 'toggle on' : 'toggle'} onClick={onToggle} title="루프 켜기/끄기 (L)">
          {enabled ? '켜짐' : '꺼짐'}
        </button>
        <span className="hint">파형 드래그로 만들기 · [ ] 시작점 · Shift+[ ] 끝점 (10ms) · Space: 정지 후 루프 처음으로 · Enter: 일시정지</span>
      </div>
      {loops.length > 0 && (
        <ul>
          {loops.map((l) => (
            <li key={l.id} className={l.id === activeId ? 'active' : undefined} onClick={() => onSelect(l.id)}>
              {editingId === l.id ? (
                <input
                  className="name-edit"
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="name"
                  title="더블클릭해 이름 변경"
                  onDoubleClick={() => {
                    setEditingId(l.id);
                    setDraft(l.name);
                  }}
                >
                  {l.name}
                </span>
              )}
              <span className="range">
                {formatLoopTime(l.a)} – {formatLoopTime(l.b)}
              </span>
              <button
                className="delete"
                title="삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(l.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
