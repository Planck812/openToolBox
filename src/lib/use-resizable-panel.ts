import { onUnmounted, ref } from 'vue';

interface ResizablePanelOptions {
  minFirstWidth: number;
  minSecondWidth: number;
  desktopBreakpoint?: number;
}

export const useResizablePanel = ({
  minFirstWidth,
  minSecondWidth,
  desktopBreakpoint = 1024,
}: ResizablePanelOptions) => {
  const containerRef = ref<HTMLElement | null>(null);
  const firstPanelRef = ref<HTMLElement | null>(null);
  const firstPanelWidth = ref<number | null>(null);
  let cancelResize: (() => void) | null = null;

  const isDesktop = () => window.matchMedia(`(min-width: ${desktopBreakpoint}px)`).matches;

  const updateWidth = (width: number) => {
    if (!containerRef.value) return;
    const maxWidth = Math.max(minFirstWidth, containerRef.value.clientWidth - minSecondWidth);
    firstPanelWidth.value = Math.min(Math.max(width, minFirstWidth), maxWidth);
  };

  const startResize = (event: PointerEvent) => {
    if (!isDesktop() || !containerRef.value || !firstPanelRef.value) return;

    cancelResize?.();
    const startX = event.clientX;
    const startWidth = firstPanelWidth.value ?? firstPanelRef.value.clientWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateWidth(startWidth + moveEvent.clientX - startX);
    };
    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      cancelResize = null;
    };

    cancelResize = stopResize;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
  };

  const handleResizeKeydown = (event: KeyboardEvent) => {
    if (!isDesktop() || !['ArrowLeft', 'ArrowRight'].includes(event.key) || !firstPanelRef.value) return;
    event.preventDefault();
    const currentWidth = firstPanelWidth.value ?? firstPanelRef.value.clientWidth;
    updateWidth(currentWidth + (event.key === 'ArrowLeft' ? -20 : 20));
  };

  onUnmounted(() => cancelResize?.());

  return { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown };
};
