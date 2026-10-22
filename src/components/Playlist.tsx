import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Playlist as PlaylistData, Track } from '../store/types';
import { formatDuration } from '../format';

interface Props {
  tracks: Track[];
  activeId: string | null;
  missing: Record<string, boolean>;
  busy: string | null; // 가져오는 중 표시
  importError: string | null;
  onDismissImportError: () => void;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
  playlists: PlaylistData[];
  currentPlaylistId: string;
  onSelectPlaylist: (id: string) => void;
  onCreatePlaylist: (name: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onDeletePlaylist: (id: string) => void;
}

type DropSide = 'before' | 'after' | null;

interface RowProps {
  track: Track;
  active: boolean;
  missing: boolean;
  drop: DropSide;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

function Row({ track, active, missing, drop, onSelect, onRename, onRemove }: RowProps) {
  // 항목은 움직이지 않고(transform 미적용) 드롭 위치만 선으로 보여준다
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: track.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    if (draft.trim()) onRename(draft.trim());
    setEditing(false);
  };

  const classes = ['track', active && 'active', missing && 'missing', isDragging && 'dragging'];
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={classes.filter(Boolean).join(' ')}
      onClick={onSelect}
      title={missing ? `파일을 찾을 수 없음: ${track.path}` : track.path}
    >
      {drop && <div className={`drop-line ${drop}`} />}
      {editing ? (
        <input
          className="name-edit"
          autoFocus
          onFocus={(e) => e.target.select()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation(); // dnd-kit 키보드 조작과 Space 재생 단축키 방지
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="name"
          onDoubleClick={() => {
            setDraft(track.displayName);
            setEditing(true);
          }}
        >
          {track.displayName}
        </span>
      )}
      <span className="duration">{formatDuration(track.durationSec)}</span>
      <button
        className="delete"
        title="플레이리스트에서 빼기 (설정은 남음)"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
    </li>
  );
}

export function Playlist(props: Props) {
  const { tracks, activeId, missing, busy, importError, onDismissImportError, onAdd, onSelect, onRename, onRemove, onMove } = props;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = tracks.map((t) => t.id);
  const dragIndex = dragId ? ids.indexOf(dragId) : -1;

  const dropSide = (id: string): DropSide => {
    if (!dragId || id !== overId || id === dragId) return null;
    return dragIndex < ids.indexOf(id) ? 'after' : 'before';
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    setOverId(null);
    if (!e.over || e.active.id === e.over.id) return;
    onMove(ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
  };

  return (
    // 드래그 중 고스트는 두지 않는다 (드롭 표시선을 가린다). 원래 항목이 흐려지고 선만 보인다
    <aside className={dragId ? "playlist dragging" : "playlist"}>
      <PlaylistPicker {...props} />
      <button className="add-tracks" onClick={onAdd} disabled={!!busy}>
        + 곡 추가
      </button>
      {busy && <div className="hint">{busy}</div>}
      {importError && (
        <div className="error import-error" onClick={onDismissImportError} title="클릭해 닫기">
          {importError}
        </div>
      )}
      {tracks.length === 0 && !busy && <div className="empty">파일을 여기로 끌어다 놓거나 + 곡 추가</div>}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
        onDragOver={(e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragId(null);
          setOverId(null);
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul>
            {tracks.map((t) => (
              <Row
                key={t.id}
                track={t}
                active={t.id === activeId}
                missing={!!missing[t.id]}
                drop={dropSide(t.id)}
                onSelect={() => onSelect(t.id)}
                onRename={(name) => onRename(t.id, name)}
                onRemove={() => onRemove(t.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </aside>
  );
}

/** 플레이리스트 선택상자 + 새로 만들기 / 이름 변경 / 삭제 */
function PlaylistPicker({ playlists, currentPlaylistId, onSelectPlaylist, onCreatePlaylist, onRenamePlaylist, onDeletePlaylist }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = playlists.find((p) => p.id === currentPlaylistId);

  // 삭제는 두 번 눌러야 한다. 잠시 뒤 확인 상태를 푼다
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const startRename = (name: string) => {
    setDraft(name);
    setRenaming(true);
  };
  const commit = () => {
    if (draft.trim()) onRenamePlaylist(currentPlaylistId, draft.trim());
    setRenaming(false);
  };

  return (
    <div className="playlist-header">
      {renaming ? (
        <input
          className="name-edit"
          autoFocus
          onFocus={(e) => e.target.select()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <select value={currentPlaylistId} onChange={(e) => onSelectPlaylist(e.target.value)}>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button
        className="icon"
        title="새 플레이리스트"
        onClick={() => {
          const name = `새 플레이리스트 ${playlists.length + 1}`;
          onCreatePlaylist(name);
          startRename(name);
        }}
      >
        +
      </button>
      <button className="icon" title="이름 변경" onClick={() => current && startRename(current.name)}>
        ✎
      </button>
      <button
        className={confirmDelete ? 'icon danger' : 'icon'}
        title={playlists.length <= 1 ? '마지막 플레이리스트는 지울 수 없음' : '플레이리스트 삭제 (곡 설정은 남음)'}
        disabled={playlists.length <= 1}
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true);
            return;
          }
          setConfirmDelete(false);
          onDeletePlaylist(currentPlaylistId);
        }}
      >
        {confirmDelete ? '정말 삭제?' : '🗑'}
      </button>
    </div>
  );
}
