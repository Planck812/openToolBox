<script setup lang="ts">
/**
 * 便利贴窗口组件。
 *
 * 通过窗口 label `sticky-<id>` 识别便利贴 id，从 store 加载数据；
 * 文本输入自动保存（防抖 300ms），支持颜色切换、分组、关闭。
 * 样式：透明圆角，颜色体系（默认 mint 浅绿）。
 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getCurrentWindow,
  currentMonitor,
  cursorPosition,
  PhysicalPosition,
  type Monitor,
  type PhysicalSize,
} from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { X } from 'lucide-vue-next';
import { stickyList, stickyUpdate, type StickyNoteData } from '@/lib/ipc/sticky';

/** 颜色体系：key → { nameKey, 背景, 标题条, 文字, 标题条文字 }。默认 mint 浅绿。nameKey 对应 i18n key tools.sticky_note.color_<nameKey>。 */
const COLORS: Record<string, { nameKey: string; bg: string; header: string; text: string; headerText: string }> = {
  mint: { nameKey: 'mint', bg: '#e3f6e0', header: '#c3e8bc', text: '#1f3a22', headerText: '#2c4a30' },
  yellow: { nameKey: 'yellow', bg: '#fdf3c8', header: '#f5e28f', text: '#4a3a00', headerText: '#4a3a00' },
  blue: { nameKey: 'blue', bg: '#dceefb', header: '#b7d9ef', text: '#18324a', headerText: '#1c3a52' },
  pink: { nameKey: 'pink', bg: '#fbe0e7', header: '#f2c2cf', text: '#4a1f2b', headerText: '#521f2d' },
  purple: { nameKey: 'purple', bg: '#eadffa', header: '#d3c0f0', text: '#332552', headerText: '#3a2a5a' },
};

/** 判断是否为自定义 hex 颜色。 */
const isHexColor = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

/** 自定义 hex → 生成协调的 header/text 色（基于亮度调整）。 */
const customColors = (hex: string): { bg: string; header: string; text: string; headerText: string } => {
  // 解析 RGB。
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // 亮度（感知）。
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // 深色背景 → 白字；浅色 → 深字。
  const text = lum < 0.5 ? '#f5f5f5' : '#1a1a1a';
  // header 加深/减淡 8%。
  const mix = (v: number, target: number) => Math.round(v + (target - v) * 0.08);
  const hr = mix(r, lum < 0.5 ? 255 : 0);
  const hg = mix(g, lum < 0.5 ? 255 : 0);
  const hb = mix(b, lum < 0.5 ? 255 : 0);
  return {
    bg: hex,
    header: `rgb(${hr}, ${hg}, ${hb})`,
    text,
    headerText: text,
  };
};

/** 分组预设。 */
const GROUPS = ['default', 'work', 'life'];

/** 拖动便利贴窗口（复用 pin 的 startDragging 方式，比 data-tauri-drag-region 可靠）。 */
const startDrag = () => {
  void win.startDragging().catch(() => {});
};

/** 自定义颜色选择。 */
const onCustomColor = (e: Event) => {
  const value = (e.target as HTMLInputElement).value;
  if (value) {
    color.value = value;
  }
};

/** 确认手动输入的分组名。 */
const confirmGroup = () => {
  const name = groupDraft.value.trim();
  if (name) {
    group.value = name;
  }
  groupMenuOpen.value = false;
};

const { t } = useI18n();

/** 颜色显示名（预设 key 或自定义 hex）。 */
const colorName = (key: string) => t(`tools.sticky_note.color_${key}`);

/** 分组显示名：预设分组走 i18n，自定义分组原样返回。 */
const groupLabel = (g: string) => {
  const key = `tools.sticky_note.group_${g}`;
  const label = t(key);
  return label === key ? g : label;
};

const win = getCurrentWindow();
const label = win.label;
const noteId = label.startsWith('sticky-') ? label.slice('sticky-'.length) : '';

const note = ref<StickyNoteData | null>(null);
const text = ref('');
const color = ref('mint');
const group = ref('default');
/** 分组手动输入草稿。 */
const groupDraft = ref('');
const colorMenuOpen = ref(false);
const groupMenuOpen = ref(false);
/** 颜色弹层容器，用于判断外部点击收起。 */
const colorWrapRef = ref<HTMLElement | null>(null);
const errorMessage = ref('');
/** 自动保存防抖计时器。 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 窗口移动/缩放事件反注册函数（onBeforeUnmount 清理）。 */
let unlistenMoved: UnlistenFn | null = null;
let unlistenResized: UnlistenFn | null = null;

/** ---- 边缘吸附（QQ 式收起贴边）---- */
type SnapEdge = 'left' | 'right' | 'top' | 'bottom';
/** monitor 工作区物理坐标边界。 */
type WorkAreaBounds = { left: number; top: number; right: number; bottom: number };

/** 靠近工作区边缘多少 px 触发收起。 */
const snapThreshold = 40;
/** 收起后露出的把手窄条宽度 px。
 *  实测 2px 太细；且 Windows/WebView2 对贴在屏幕右缘的极细窗口条带合成不稳定
 *  （左侧因坐标原点在左上边缘像素稳定，右侧极细条有时不渲染/被吃）。
 *  提到 12px：足够宽到右侧稳定渲染，且左右观感一致、用户不易忘记便利贴收在边上。 */
const handleWidth = 12;
/** 悬停展开后，鼠标移开多少 ms 收回。 */
const retractDelay = 600;
/** 收起态鼠标位置轮询间隔 ms。 */
const pollInterval = 100;
/** 拖动停止多少 ms 判定为拖动结束（触发吸附检查）。 */
const dragStopDelay = 80;
/** 把手/展开窗口检测的外扩 buffer px。 */
const handleBuffer = 12;
const expandedBuffer = 8;
/** 程序化 setPosition 触发的 onMoved 在此窗口期内忽略（避免把收起/展开当作用户拖动）。 */
const programmaticMoveWindow = 500;

/** 三态：expanded（展开）/ snapped（收起露窄条）。 */
const mode = ref<'expanded' | 'snapped'>('expanded');
/** 收起贴边方向。 */
const snapEdge = ref<SnapEdge | null>(null);
/** 展开态位置记忆（收起前 / 悬停滑出的目标）。 */
const expandedPos = ref<PhysicalPosition | null>(null);
/** 是否「悬停滑出」的展开态（鼠标移开后自动收回）。 */
const peekExpanded = ref(false);
/** 收起态把手位置（重算/滑出时更新；轮询据此检测把手，避免依赖移出屏幕后可能失效的 currentMonitor）。 */
const snappedPos = ref<PhysicalPosition | null>(null);
/** 收起时所在 monitor 工作区边界缓存（同上）。 */
let snapWorkArea: WorkAreaBounds | null = null;
/** 最近一次窗口移动时间戳（拖动停止判定）。 */
let lastMoveAt = 0;
/** 吸附检查防抖计时器。 */
let snapCheckTimer: ReturnType<typeof setTimeout> | null = null;
/** 收起态轮询计时器。 */
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** 悬停收回计时器。 */
let retractTimer: ReturnType<typeof setTimeout> | null = null;
/** 最近一次程序化 setPosition 时间戳（区分程序化移动与用户拖动）。 */
let lastProgrammaticMoveAt = 0;
/** 吸附过渡动画进行中标志（动画期间跳过鼠标轮询收回，避免滑出时被判定移开）。 */
let animating = false;

/** ease-in-out 三次缓动（卷轴平滑滑出/滑入手感的曲线）。 */
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** 固定间隔等待。 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 把窗口从当前实际位置平滑动画移动到 target（逐帧插值，ease-in-out）。
 *  每帧移动都触发 onMoved，但落在 lastProgrammaticMoveAt 的 programmaticMoveWindow 内，
 *  会被 onMoved guard 忽略，不会当作用户拖动。 */
const animateMove = async (to: PhysicalPosition, duration = 240): Promise<void> => {
  const from = await win.innerPosition();
  if (from.x === to.x && from.y === to.y) return;
  animating = true;
  const steps = 24;
  const stepMs = Math.max(1, Math.round(duration / steps));
  try {
    for (let i = 1; i <= steps; i++) {
      const e = easeInOutCubic(i / steps);
      await win.setPosition(
        new PhysicalPosition(
          Math.round(from.x + (to.x - from.x) * e),
          Math.round(from.y + (to.y - from.y) * e),
        ),
      );
      await sleep(stepMs);
    }
    // 精确落到目标点，消除插值舍入残差。
    await win.setPosition(to);
  } finally {
    animating = false;
  }
};

/** 吸附收起态判定：窗口任一方向越出当前 monitor 工作区即视为收起。
 *  收起态不保存位置，避免越界坐标污染 store。右/下边收起态窗口原点可能仍在
 *  工作区内（主体越界但原点未越），因此按「窗口四边是否越出工作区」判定。 */
const isSnappedPosition = (
  pos: PhysicalPosition,
  size: PhysicalSize,
  monitor: Monitor | null,
): boolean => {
  if (!monitor) return false;
  const { position, size: waSize } = monitor.workArea;
  const left = position.x;
  const top = position.y;
  const right = left + waSize.width;
  const bottom = top + waSize.height;
  return (
    pos.x < left || pos.y < top ||
    pos.x + size.width > right || pos.y + size.height > bottom
  );
};

/** clamp 数值到 [min, max]。 */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** monitor 工作区 → 物理坐标边界。 */
const toWorkAreaBounds = (monitor: Monitor): WorkAreaBounds => {
  const { position, size } = monitor.workArea;
  return {
    left: position.x,
    top: position.y,
    right: position.x + size.width,
    bottom: position.y + size.height,
  };
};

/** 窗口四边距 monitor 工作区最近边与距离（物理坐标）。
 *  已越过边界的方向（distance < 0，窗口该边被拖进工作区外侧）同样触发吸附——
 *  用户用力拖过头也是明确的贴边意图，不应丢弃（否则左边缘被推进屏幕里侧就不吸附）。
 *  取四边距中最小距离（含负值；负越多 = 越过头），返回该方向。 */
const nearestSnapEdge = (
  pos: PhysicalPosition,
  size: PhysicalSize,
  bounds: WorkAreaBounds,
): { edge: SnapEdge; distance: number } | null => {
  const candidates: { edge: SnapEdge; distance: number }[] = [
    { edge: 'left', distance: pos.x - bounds.left },
    { edge: 'right', distance: bounds.right - (pos.x + size.width) },
    { edge: 'top', distance: pos.y - bounds.top },
    { edge: 'bottom', distance: bounds.bottom - (pos.y + size.height) },
  ];
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.distance < best.distance ? c : best));
};

/** 计算收起目标位置：沿 edge 把窗口移出工作区，只露 handleWidth 把手（物理坐标）。 */
const computeSnappedPos = (
  pos: PhysicalPosition,
  size: PhysicalSize,
  bounds: WorkAreaBounds,
  edge: SnapEdge,
): PhysicalPosition => {
  let x = pos.x;
  let y = pos.y;
  if (edge === 'left') x = bounds.left + handleWidth - size.width;
  else if (edge === 'right') x = bounds.right - handleWidth;
  else if (edge === 'top') y = bounds.top + handleWidth - size.height;
  else if (edge === 'bottom') y = bounds.bottom - handleWidth;
  return new PhysicalPosition(x, y);
};

/** 鼠标是否在展开窗口 rect + buffer 内（物理坐标）。 */
const isCursorInExpandedRect = (
  cursor: PhysicalPosition,
  pos: PhysicalPosition,
  size: PhysicalSize,
  buffer: number,
): boolean =>
  cursor.x >= pos.x - buffer &&
  cursor.x <= pos.x + size.width + buffer &&
  cursor.y >= pos.y - buffer &&
  cursor.y <= pos.y + size.height + buffer;

/** 鼠标是否在「把手窄条 + buffer」区域（物理坐标）。
 *  收起时窗口整体偏移出工作区，露出的可见把手位于窗口**靠工作区边缘的那一侧**：
 *  left 边收起 → 窗口右缘露出；right 边收起 → 窗口左缘露出；
 *  top 边收起 → 窗口下缘露出；bottom 边收起 → 窗口上缘露出。 */
const isCursorInHandleArea = (
  cursor: PhysicalPosition,
  pos: PhysicalPosition,
  size: PhysicalSize,
  edge: SnapEdge,
  buffer: number,
): boolean => {
  const { x, y } = cursor;
  if (edge === 'left' || edge === 'right') {
    // 垂直把手：覆盖窗口全高 + buffer。
    if (y < pos.y - buffer || y > pos.y + size.height + buffer) return false;
    // left 边把手在窗口右缘；right 边把手在窗口左缘。
    if (edge === 'left') {
      return x >= pos.x + size.width - handleWidth - buffer && x <= pos.x + size.width + buffer;
    }
    return x >= pos.x - buffer && x <= pos.x + handleWidth + buffer;
  }
  // 水平把手（top/bottom）。
  if (x < pos.x - buffer || x > pos.x + size.width + buffer) return false;
  // top 边把手在窗口下缘；bottom 边把手在窗口上缘。
  if (edge === 'top') {
    return y >= pos.y + size.height - handleWidth - buffer && y <= pos.y + size.height + buffer;
  }
  return y >= pos.y - buffer && y <= pos.y + handleWidth + buffer;
};

/** 当前颜色：预设 key 或自定义 hex，统一为 {bg, header, text, headerText}。 */
const currentColors = computed(() => {
  if (isHexColor(color.value)) return customColors(color.value);
  return COLORS[color.value] ?? COLORS.mint;
});

/** 加载便利贴数据。 */
const loadNote = async () => {
  if (!noteId) {
    errorMessage.value = t('tools.sticky_note.id_missing');
    return;
  }
  // 本地初始化默认便利贴（即使 store 里还没数据，也能编辑，输入后自动保存）。
  note.value = {
    id: noteId,
    text: '',
    color: 'mint',
    group: 'default',
    x: 100,
    y: 100,
    width: 220,
    height: 220,
  };
  try {
    const notes = await stickyList();
    const found = notes.find((n) => n.id === noteId);
    if (found) {
      note.value = found;
      text.value = found.text;
      color.value = found.color;
      group.value = found.group;
    }
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 保存当前数据到 store（防抖由调用方控制）。 */
const save = async () => {
  if (!note.value) return;
  const updated: StickyNoteData = {
    ...note.value,
    text: text.value,
    color: color.value,
    group: group.value,
  };
  // 位置/大小持久化：从窗口实时读取，满足「关闭后重开恢复位置」。
  // 吸附收起态（窗口原点越出 monitor 工作区）跳过位置保存，避免越界坐标污染 store。
  try {
    const [pos, size, monitor] = await Promise.all([
      win.innerPosition(),
      win.innerSize(),
      currentMonitor(),
    ]);
    if (!isSnappedPosition(pos, size, monitor)) {
      updated.x = pos.x;
      updated.y = pos.y;
      updated.width = size.width;
      updated.height = size.height;
    }
  } catch {
    // 位置读取失败不阻塞文本/颜色/分组保存。
  }
  note.value = updated;
  try {
    await stickyUpdate(updated);
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 输入自动保存（防抖 300ms）。 */
const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), 300);
};

/** 关闭便利贴：删除数据 + 关窗。 */
const closeNote = async () => {
  // 关闭 = 隐藏窗口（保留数据）。删除只通过管理页的垃圾桶操作。
  // 先保存当前文本（确保关闭前的输入已落盘）。
  await save();
  try {
    await win.close();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 监听文本变化自动保存。 */
watch(text, () => scheduleSave());
watch(color, () => scheduleSave());
watch(group, () => scheduleSave());

/** 进入收起态：把窗口移到 snapped 位置（只露把手）。 */
const enterSnapped = async (
  edge: SnapEdge,
  fromPos: PhysicalPosition,
  size: PhysicalSize,
  bounds: WorkAreaBounds,
) => {
  snapEdge.value = edge;
  // 展开目标 = 吸附边对齐、窗口**完整落在 workArea 内**的位置，而非用户拖过头（插入）的位置。
  // 否则插入边缘吸附后，悬停滑出又弹回半截插进屏幕外的状态，露出不完整。
  expandedPos.value = new PhysicalPosition(
    edge === 'left' ? bounds.left
      : edge === 'right' ? bounds.right - size.width
      : clamp(fromPos.x, bounds.left, bounds.right - size.width),
    edge === 'top' ? bounds.top
      : edge === 'bottom' ? bounds.bottom - size.height
      : clamp(fromPos.y, bounds.top, bounds.bottom - size.height),
  );
  snapWorkArea = bounds;
  mode.value = 'snapped';
  peekExpanded.value = false;
  if (retractTimer) { clearTimeout(retractTimer); retractTimer = null; }
  const target = computeSnappedPos(fromPos, size, bounds, edge);
  snappedPos.value = target;
  lastProgrammaticMoveAt = Date.now();
  try {
    await animateMove(target);
  } catch (e) {
    console.warn('Snap position failed:', e);
  }
};

/** 悬停滑出：回到展开位置，进入「悬停展开」态（鼠标移开后自动收回）。 */
const expandFromSnap = async () => {
  if (mode.value !== 'snapped' || !expandedPos.value) return;
  mode.value = 'expanded';
  peekExpanded.value = true;
  if (retractTimer) { clearTimeout(retractTimer); retractTimer = null; }
  lastProgrammaticMoveAt = Date.now();
  try {
    await animateMove(expandedPos.value);
  } catch (e) {
    console.warn('Expand position failed:', e);
  }
};

/** 悬停展开后鼠标移开：收回为窄条。 */
const retractToSnap = async () => {
  if (mode.value !== 'expanded' || !peekExpanded.value || !snapEdge.value || !snapWorkArea) return;
  const [pos, size] = await Promise.all([win.innerPosition(), win.innerSize()]);
  retractTimer = null;
  mode.value = 'snapped';
  peekExpanded.value = false;
  const target = computeSnappedPos(pos, size, snapWorkArea, snapEdge.value);
  snappedPos.value = target;
  lastProgrammaticMoveAt = Date.now();
  try {
    await animateMove(target);
  } catch (e) {
    console.warn('Retract position failed:', e);
  }
};

/** 收起态窗口被缩放：重算收起目标位置，保持只露把手。 */
const reapplySnappedPosition = async () => {
  if (mode.value !== 'snapped' || !snapEdge.value || !snapWorkArea) return;
  const [pos, size] = await Promise.all([win.innerPosition(), win.innerSize()]);
  const target = computeSnappedPos(pos, size, snapWorkArea, snapEdge.value);
  snappedPos.value = target;
  lastProgrammaticMoveAt = Date.now();
  try {
    await animateMove(target);
  } catch (e) {
    console.warn('Re-snap position failed:', e);
  }
};

/** 拖动停止后检查吸附：窗口距工作区边缘 ≤ 阈值 → 收起。 */
const checkSnap = async () => {
  if (mode.value !== 'expanded') return;
  // 拖动仍在进行中（仍有 onMoved）→ 跳过。
  if (Date.now() - lastMoveAt < dragStopDelay) return;
  const [pos, size, monitor] = await Promise.all([
    win.innerPosition(),
    win.innerSize(),
    currentMonitor(),
  ]);
  if (!monitor) return;
  const bounds = toWorkAreaBounds(monitor);
  const snap = nearestSnapEdge(pos, size, bounds);
  if (snap && snap.distance <= snapThreshold) {
    await enterSnapped(snap.edge, pos, size, bounds);
  }
};

/** 防抖吸附检查：拖动停止 dragStopDelay 后才执行。 */
const scheduleSnapCheck = () => {
  if (snapCheckTimer) clearTimeout(snapCheckTimer);
  snapCheckTimer = setTimeout(() => void checkSnap().catch(() => {}), dragStopDelay);
};

/** 收起/悬停展开态轮询鼠标位置（普通展开态早退，零 IPC 开销）。 */
const pollCursor = async () => {
  if (animating) return; // 过渡动画期间不轮询，避免滑出时被误判移开而打断收回。
  const polling = mode.value === 'snapped' || (mode.value === 'expanded' && peekExpanded.value);
  if (!polling) return;
  const cursor = await cursorPosition();
  if (mode.value === 'snapped') {
    // 鼠标落在把手区域 → 滑出展开。
    if (snapEdge.value && snappedPos.value) {
      const size = await win.innerSize();
      if (isCursorInHandleArea(cursor, snappedPos.value, size, snapEdge.value, handleBuffer)) {
        await expandFromSnap();
      }
    }
    return;
  }
  // 悬停展开态：鼠标在展开窗口或把手附近 → 保持展开；移开 → 计时收回。
  const [pos, size] = await Promise.all([win.innerPosition(), win.innerSize()]);
  const inExpanded = isCursorInExpandedRect(cursor, pos, size, expandedBuffer);
  const inHandle =
    snapEdge.value && snappedPos.value
      ? isCursorInHandleArea(cursor, snappedPos.value, size, snapEdge.value, handleBuffer)
      : false;
  if (inExpanded || inHandle) {
    if (retractTimer) { clearTimeout(retractTimer); retractTimer = null; }
    return;
  }
  if (!retractTimer) {
    retractTimer = setTimeout(() => void retractToSnap().catch(() => {}), retractDelay);
  }
};

/** 用户与展开的便利贴交互（点击/拖动）→ 取消悬停自动收回。 */
const onRootPointerDown = () => {
  if (peekExpanded.value) peekExpanded.value = false;
  if (retractTimer) { clearTimeout(retractTimer); retractTimer = null; }
};

/** 颜色弹层打开时，点击弹层外部 → 收起。 */
const onDocumentPointerDown = (e: PointerEvent) => {
  if (colorMenuOpen.value && colorWrapRef.value && !colorWrapRef.value.contains(e.target as Node)) {
    colorMenuOpen.value = false;
  }
};

onMounted(async () => {
  void loadNote();
  document.addEventListener('pointerdown', onDocumentPointerDown);
  window.addEventListener('beforeunload', () => {
    // 系统关闭窗口（Alt+F4 等）时冲刷挂起的防抖保存，避免 300ms 防抖窗口内的输入丢失。
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      void save().catch(() => {});
    }
  });
  // 窗口移动/缩放后防抖保存位置与大小（收起态跳过，见 isSnappedPosition）。
  try {
    unlistenMoved = await win.onMoved(({ payload: pos }) => {
      lastMoveAt = Date.now();
      scheduleSave();
      // 程序化 setPosition（收起/展开/收回）触发的事件不当作用户拖动。
      if (Date.now() - lastProgrammaticMoveAt < programmaticMoveWindow) return;
      if (mode.value === 'expanded') {
        expandedPos.value = pos;
        // 用户在展开态拖动：取消悬停自动收回，进入普通展开态。
        if (peekExpanded.value) peekExpanded.value = false;
        if (retractTimer) { clearTimeout(retractTimer); retractTimer = null; }
        scheduleSnapCheck();
      } else if (mode.value === 'snapped') {
        // 用户拖动收起态的把手：取消收起态，交给原生拖动自由移动。
        mode.value = 'expanded';
        peekExpanded.value = false;
        expandedPos.value = pos;
        snapEdge.value = null;
        snapWorkArea = null;
        snappedPos.value = null;
        if (retractTimer) { clearTimeout(retractTimer); retractTimer = null; }
        scheduleSnapCheck();
      }
    });
    unlistenResized = await win.onResized(() => {
      scheduleSave();
      if (mode.value === 'expanded') {
        // 悬停展开（peek）时窗口正处于展开位置（靠近边缘），缩放属于用户主动交互，
        // 跳过吸附检查，避免缩放过程中窗口被误收回（正常展开态仍保留缩放后重新吸附）。
        if (!peekExpanded.value) scheduleSnapCheck();
      } else if (mode.value === 'snapped') {
        // 收起态窗口被缩放：重算收起位置。
        void reapplySnappedPosition();
      }
    });
  } catch (e) {
    console.warn('Failed to register sticky window move/resize listeners:', e);
  }
  // 收起态/悬停展开态轮询鼠标位置（普通展开态早退，开销可忽略）。
  pollTimer = setInterval(() => void pollCursor().catch(() => {}), pollInterval);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  if (saveTimer) clearTimeout(saveTimer);
  if (snapCheckTimer) clearTimeout(snapCheckTimer);
  if (retractTimer) clearTimeout(retractTimer);
  if (pollTimer) clearInterval(pollTimer);
  unlistenMoved?.();
  unlistenResized?.();
});
</script>

<template>
  <div class="sticky-root" :style="{ background: currentColors.bg }" @pointerdown="onRootPointerDown">
    <!-- 标题条：左侧颜色/分组，中间拖拽区，右侧关闭（hover 浮现） -->
    <div
      class="sticky-header"
      :style="{ background: currentColors.header, color: currentColors.headerText }"
    >
      <div class="sticky-left">
        <!-- 颜色选择 -->
        <div ref="colorWrapRef" class="sticky-pop-wrap">
          <button
            class="sticky-btn sticky-color-btn"
            :title="t('tools.sticky_note.color_label')"
            :aria-expanded="colorMenuOpen"
            aria-haspopup="true"
            @click.stop="colorMenuOpen = !colorMenuOpen"
            @keydown.escape="colorMenuOpen = false"
          >
            <span
              class="sticky-color-swatch"
              :style="{ background: currentColors.bg }"
            ></span>
          </button>
          <div v-if="colorMenuOpen" class="sticky-pop sticky-color-pop" @keydown.escape="colorMenuOpen = false">
            <div class="sticky-color-grid">
              <button
                v-for="(c, key) in COLORS"
                :key="key"
                class="sticky-color-opt"
                :class="{ active: color === key || (isHexColor(color) && currentColors.bg === c.bg) }"
                :title="colorName(c.nameKey)"
                @click.stop="color = key; colorMenuOpen = false"
              >
                <span
                  class="sticky-color-swatch"
                  :style="{ background: c.bg }"
                ></span>
              </button>
            </div>
            <!-- 自定义选色盘 -->
            <div class="sticky-color-custom">
              <input
                type="color"
                class="sticky-color-input"
                :value="isHexColor(color) ? color : '#e3f6e0'"
                @input.stop="onCustomColor"
                @click.stop
              />
              <span class="sticky-color-custom-label">{{ t('tools.sticky_note.color_custom') }}</span>
            </div>
          </div>
        </div>
        <!-- 分组选择：下拉预设 + 手动输入 -->
        <div class="sticky-pop-wrap">
          <button
            class="sticky-group-btn"
            :title="t('tools.sticky_note.group_label')"
            @click.stop="groupMenuOpen = !groupMenuOpen"
          >{{ groupLabel(group) }}</button>
          <div v-if="groupMenuOpen" class="sticky-pop sticky-pop-left">
            <input
              v-model="groupDraft"
              class="sticky-group-input"
              :placeholder="t('tools.sticky_note.group_placeholder')"
              @keydown.enter="confirmGroup"
              @keydown.escape="groupMenuOpen = false"
              @click.stop
            />
            <button
              v-for="g in GROUPS"
              :key="g"
              class="sticky-group-opt"
              :class="{ active: group === g }"
              @click.stop="group = g; groupMenuOpen = false"
            >{{ groupLabel(g) }}</button>
          </div>
        </div>
      </div>
      <!-- 拖拽区：撑满中间，pointerdown 触发窗口拖动 -->
      <div class="sticky-drag" @pointerdown="startDrag"></div>
      <!-- 关闭（鼠标进入便利贴才浮现） -->
      <button class="sticky-btn sticky-btn-danger sticky-close" :title="t('tools.sticky_note.close_label')" @click.stop="closeNote">
        <X class="w-4 h-4" />
      </button>
    </div>
    <!-- 文本输入区 -->
    <textarea
      v-model="text"
      class="sticky-text"
      :style="{ color: currentColors.text, caretColor: currentColors.headerText }"
      :placeholder="t('tools.sticky_note.text_placeholder')"
      spellcheck="false"
    ></textarea>
    <!-- 错误提示 -->
    <div v-if="errorMessage" class="sticky-error">{{ errorMessage }}</div>
  </div>
</template>

<style scoped>
.sticky-root {
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  /* overflow: visible：不裁剪 popover（滚动条隐藏由 textarea scrollbar-width + 全局 body overflow hidden 处理） */
  overflow: visible;
  background: #e3f6e0;
  box-shadow: none;
  font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.sticky-header {
  display: flex;
  align-items: center;
  height: 36px;
  flex-shrink: 0;
  padding: 0 8px;
  user-select: none;
  /* 标题条与正文的分界：底部细描边，带色相 */
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.06);
}
.sticky-left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.sticky-drag {
  flex: 1;
  align-self: stretch;
  height: 100%;
  min-width: 40px;
  cursor: move;
}
.sticky-close {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, transform 0.08s;
}
/* 鼠标进入便利贴整体时浮现关闭按钮 */
.sticky-root:hover .sticky-close {
  opacity: 1;
}
/* 键盘聚焦关闭按钮时也浮现（避免 opacity:0 却在 tab 序中不可见） */
.sticky-close:focus-visible {
  opacity: 1;
}
/* 统一的交互按钮：圆角一致，hover 淡入，active 按压触感 */
.sticky-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s, transform 0.08s;
}
.sticky-btn:hover {
  background: rgba(0, 0, 0, 0.08);
}
.sticky-btn:active {
  transform: scale(0.92);
}
.sticky-btn-danger:hover {
  background: rgba(255, 71, 87, 0.2);
}
.sticky-btn-danger svg {
  display: block;
}
/* 当前颜色按钮的色块（带白描边 + 阴影，清晰可见） */
.sticky-color-swatch {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  transition: transform 0.12s;
}
/* popover 里的色块更大，易点选 */
.sticky-color-opt .sticky-color-swatch {
  width: 22px;
  height: 22px;
}
.sticky-color-opt:hover .sticky-color-swatch {
  transform: scale(1.1);
}
.sticky-group-btn {
  border: none;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s, transform 0.08s;
  white-space: nowrap;
}
.sticky-group-btn:hover {
  background: rgba(0, 0, 0, 0.12);
}
.sticky-group-btn:active {
  transform: scale(0.96);
}
.sticky-group-input {
  border: 1px solid rgba(0, 0, 0, 0.16);
  background: rgba(255, 255, 255, 0.85);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  width: 132px;
  margin-bottom: 4px;
  outline: none;
  color: #333;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.sticky-group-input:focus {
  border-color: rgba(0, 0, 0, 0.35);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.05);
}
.sticky-pop-wrap {
  position: relative;
}
.sticky-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: flex;
  gap: 4px;
  /* 毛玻璃 + 柔阴影（带色相，非纯黑） */
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 7px;
  box-shadow: 0 12px 32px rgba(60, 60, 80, 0.18), 0 2px 8px rgba(60, 60, 80, 0.1);
}
.sticky-pop-left {
  right: auto;
  left: 0;
  flex-direction: column;
  align-items: stretch;
}
/* 颜色 popover：竖排网格，避免横向过长超出窗口 */
.sticky-color-pop {
  flex-direction: column;
  gap: 6px;
  width: auto;
  /* 固定定位：在 header 下方左侧展开，摆脱按钮相对定位和窗口裁剪 */
  position: fixed;
  top: 38px;
  left: 8px;
  z-index: 50;
}
.sticky-color-grid {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 6px;
}
.sticky-color-opt {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  transition: transform 0.12s;
}
.sticky-color-opt:hover {
  transform: scale(1.08);
}
.sticky-color-opt.active {
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.45);
  border-radius: 6px;
}
/* 自定义选色盘 */
.sticky-color-custom {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.sticky-color-input {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  padding: 0;
  background: transparent;
  cursor: pointer;
  /* 隐藏原生色块边框，用 swatch 效果 */
  appearance: none;
  -webkit-appearance: none;
}
.sticky-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}
.sticky-color-input::-webkit-color-swatch {
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  border-radius: 6px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.sticky-color-custom-label {
  font-size: 12px;
  color: #555;
}
.sticky-group-opt {
  border: none;
  background: transparent;
  padding: 5px 12px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 12px;
  color: #333;
  text-align: left;
  transition: background 0.12s;
}
.sticky-group-opt:hover {
  background: rgba(0, 0, 0, 0.07);
}
.sticky-group-opt.active {
  background: rgba(0, 0, 0, 0.11);
  font-weight: 600;
}
.sticky-text {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  box-sizing: border-box;
  padding: 12px 14px;
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  font-family: inherit;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.sticky-text::-webkit-scrollbar {
  display: none;
}
.sticky-text::placeholder {
  opacity: 0.45;
}
.sticky-error {
  position: absolute;
  bottom: 8px;
  left: 14px;
  right: 14px;
  font-size: 11px;
  color: #c62828;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.6);
}
</style>
