import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import type { Loop } from '../store/types';

export interface LoopRange {
  a: number;
  b: number;
}

interface Props {
  buffer: AudioBuffer;
  position: number;
  playing: boolean;
  followKey: number; // 바뀔 때마다(사용자 탐색, 재생 시작) 커서 따라가기를 다시 켠다
  loops: Loop[];
  activeLoopId: string | null;
  loopEnabled: boolean;
  onSeek: (sec: number) => void;
  onLoopCreate: (range: LoopRange) => void;
  onLoopChange: (id: string, range: LoopRange) => void;
  onLoopSelect: (id: string) => void;
}

const WAVE_HEIGHT = 160;
const RULER_HEIGHT = 20;
const MAX_PX_PER_SEC = 2000;
const MIN_LOOP_SEC = 0.05; // 이보다 짧은 드래그는 클릭 실수로 본다
const COLOR_ACTIVE = 'rgba(79, 156, 240, 0.30)';
const COLOR_ACTIVE_OFF = 'rgba(79, 156, 240, 0.15)'; // 활성 루프지만 루프가 꺼짐
const COLOR_INACTIVE = 'rgba(255, 255, 255, 0.12)';

function loopLabel(name: string, active: boolean): HTMLElement {
  const el = document.createElement('div');
  el.textContent = name;
  Object.assign(el.style, {
    marginTop: '2px',
    padding: '1px 6px',
    fontSize: '11px',
    whiteSpace: 'nowrap',
    color: active ? '#e3e5e8' : '#8b9099',
    background: active ? 'rgba(79, 156, 240, 0.6)' : 'rgba(0, 0, 0, 0.35)',
    borderRadius: '3px',
    width: 'fit-content',
  });
  return el;
}

/**
 * 파형 표시 전용. 재생은 하지 않는다 (wavesurfer 내부 미디어는 쓰지 않고 위치만 받아 그린다).
 * - 파형 드래그: 새 루프 (만들어진 임시 영역은 지우고 onLoopCreate로 넘긴다)
 * - 우클릭 드래그 / Shift+휠: 화면 이동, 휠: 마우스 위치 기준 확대/축소
 * - 모든 루프를 id로 동기화해 표시한다
 * - 진행색: 루프가 켜져 있으면 루프 시작점 이후만 칠한다
 * 눈금자 아래로 진행/커서/루프 영역을 내리는 배치는 App.css의 ::part 규칙이 맡는다.
 */
export function Waveform(p: Props) {
  const container = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const pxPerSec = useRef(0); // 0 = 화면 폭에 맞춤
  const followPaused = useRef(false); // 사용자가 화면을 옮겨서 커서 따라가기를 잠시 멈춤
  const pausedView = useRef({ scroll: -1, cursorVisible: false }); // 멈춘 동안 직전 프레임의 화면 상태
  const updateClipRef = useRef<() => void>(() => {});
  // peaks를 줘도 적재는 비동기다. 그 전에 zoom/setTime/addRegion을 부르면 예외가 난다
  const [ready, setReady] = useState(false);
  // 이벤트 핸들러가 항상 최신 props를 보도록
  const props = useRef(p);
  props.current = p;

  useEffect(() => {
    const { buffer } = p;
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
    const regionsPlugin = RegionsPlugin.create();
    const instance = WaveSurfer.create({
      container: container.current!,
      height: WAVE_HEIGHT,
      waveColor: '#5a6270',
      progressColor: '#4f9cf0',
      cursorColor: '#e3e5e8',
      cursorWidth: 1,
      peaks: channels,
      duration: buffer.duration,
      autoScroll: false,
      autoCenter: false,
      plugins: [
        TimelinePlugin.create({
          height: RULER_HEIGHT,
          insertPosition: 'beforebegin',
          style: { color: '#8b9099', fontSize: '11px' },
        }),
        regionsPlugin,
      ],
    });
    setReady(false);
    pxPerSec.current = 0;
    instance.on('decode', () => setReady(true));
    instance.on('interaction', (t) => props.current.onSeek(t));
    regionsPlugin.enableDragSelection({ color: COLOR_ACTIVE });
    regionsPlugin.on('region-created', (r: Region) => {
      if (props.current.loops.some((l) => l.id === r.id)) return;
      r.remove();
      if (r.end - r.start >= MIN_LOOP_SEC) props.current.onLoopCreate({ a: r.start, b: r.end });
    });
    regionsPlugin.on('region-updated', (r: Region) => props.current.onLoopChange(r.id, { a: r.start, b: r.end }));
    regionsPlugin.on('region-clicked', (r: Region, e: MouseEvent) => {
      e.stopPropagation(); // 탐색 대신 루프 선택
      props.current.onLoopSelect(r.id);
    });
    ws.current = instance;
    regions.current = regionsPlugin;

    // 우클릭 드래그 = 화면 이동. 영역 드래그/탐색보다 먼저 받도록 래퍼에서 캡처로 가로챈다
    const wrapper = instance.getWrapper();
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      e.stopPropagation();
      e.preventDefault();
      followPaused.current = true;
      const startX = e.clientX;
      const startScroll = instance.getScroll();
      const onMove = (m: PointerEvent) => instance.setScroll(startScroll - (m.clientX - startX));
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    wrapper.addEventListener('pointerdown', onPointerDown, { capture: true });
    wrapper.addEventListener('contextmenu', onContextMenu);

    // 진행색을 루프 시작점 이후로 제한. 확대/크기 변경 시 픽셀 위치가 바뀌므로 다시 계산한다
    const updateClip = () => {
      const progress = wrapper.querySelector<HTMLElement>('[part="progress"]');
      if (!progress) return;
      const { loops, activeLoopId, loopEnabled } = props.current;
      const loop = loopEnabled ? loops.find((l) => l.id === activeLoopId) : undefined;
      const left = loop ? (loop.a / instance.getDuration()) * wrapper.scrollWidth : 0;
      progress.style.clipPath = left > 0 ? `inset(0 0 0 ${left}px)` : '';
    };
    updateClipRef.current = updateClip;
    instance.on('zoom', updateClip);
    instance.on('redraw', updateClip);

    return () => {
      updateClipRef.current = () => {};
      wrapper.removeEventListener('pointerdown', onPointerDown, { capture: true });
      wrapper.removeEventListener('contextmenu', onContextMenu);
      instance.destroy();
      ws.current = null;
      regions.current = null;
    };
    // buffer가 바뀔 때만 새로 만든다
  }, [p.buffer]);

  // 휠: 확대/축소(마우스 위치 고정), Shift+휠 또는 가로 휠: 이동
  useEffect(() => {
    const el = container.current;
    if (!el || !ready) return;
    const onWheel = (e: WheelEvent) => {
      const instance = ws.current;
      if (!instance) return;
      e.preventDefault();
      followPaused.current = true;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        instance.setScroll(instance.getScroll() + (e.shiftKey ? e.deltaY : e.deltaX));
        return;
      }
      const fit = instance.getWidth() / instance.getDuration();
      const current = pxPerSec.current || fit;
      const next = Math.max(fit, Math.min(MAX_PX_PER_SEC, current * Math.exp(-e.deltaY * 0.002)));
      if (next === current) return;
      const mouseX = e.clientX - el.getBoundingClientRect().left;
      const t = (instance.getScroll() + mouseX) / current;
      pxPerSec.current = next <= fit ? 0 : next;
      instance.zoom(pxPerSec.current);
      instance.setScroll(t * next - mouseX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ready]);

  /** 커서가 화면 안에 있는지. 확대하지 않았으면 항상 보인다 */
  const cursorInView = (instance: WaveSurfer) => {
    if (!pxPerSec.current) return true;
    const x = props.current.position * pxPerSec.current;
    const scroll = instance.getScroll();
    return x >= scroll && x <= scroll + instance.getWidth() * 0.95;
  };
  const scrollToCursor = (instance: WaveSurfer) => {
    instance.setScroll(props.current.position * pxPerSec.current - instance.getWidth() * 0.05);
  };

  // 재생 위치. 재생 중 커서가 화면을 벗어나면 따라간다.
  // 사용자가 화면을 옮긴 뒤에는 멈춘다. 다만 화면이 그대로인 채 보이던 커서가 오른쪽 끝에
  // 닿으면(사용자가 커서를 보고 있다는 뜻) 다시 따라간다
  useEffect(() => {
    const instance = ws.current;
    if (!ready || !instance) return;
    instance.setTime(p.position);
    if (!p.playing) return;
    const visible = cursorInView(instance);
    if (followPaused.current) {
      const scroll = instance.getScroll();
      const viewMoved = scroll !== pausedView.current.scroll;
      const reachedEdge = !viewMoved && pausedView.current.cursorVisible && !visible;
      pausedView.current = { scroll, cursorVisible: visible };
      if (!reachedEdge) return;
      followPaused.current = false;
    }
    if (!visible) scrollToCursor(instance);
  }, [p.position, p.playing, ready]);

  // 사용자가 위치를 바꾸거나 재생을 시작하면 다시 따라가고, 커서를 화면에 보여준다
  useEffect(() => {
    const instance = ws.current;
    if (!ready || !instance) return;
    followPaused.current = false;
    if (!cursorInView(instance)) scrollToCursor(instance);
  }, [p.followKey, ready]);

  // 루프 → 영역 동기화
  useEffect(() => {
    const plugin = regions.current;
    if (!plugin || !ready) return;
    const existing = new Map(plugin.getRegions().map((r) => [r.id, r]));
    for (const loop of p.loops) {
      const active = loop.id === p.activeLoopId;
      const color = active ? (p.loopEnabled ? COLOR_ACTIVE : COLOR_ACTIVE_OFF) : COLOR_INACTIVE;
      const region = existing.get(loop.id);
      existing.delete(loop.id);
      const labelKey = `${loop.name}|${active}`;
      if (!region) {
        const r = plugin.addRegion({ id: loop.id, start: loop.a, end: loop.b, color, content: loopLabel(loop.name, active) });
        r.element?.setAttribute('data-label', labelKey);
        continue;
      }
      if (region.start !== loop.a || region.end !== loop.b) region.setOptions({ start: loop.a, end: loop.b });
      region.setOptions({ color });
      if (region.element?.getAttribute('data-label') !== labelKey) {
        region.setOptions({ content: loopLabel(loop.name, active) });
        region.element?.setAttribute('data-label', labelKey);
      }
    }
    existing.forEach((r) => r.remove());
    updateClipRef.current();
  }, [p.loops, p.activeLoopId, p.loopEnabled, ready]);

  return <div className="waveform" ref={container} />;
}
