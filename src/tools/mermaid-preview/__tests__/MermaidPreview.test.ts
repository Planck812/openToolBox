import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MermaidPreview from '@/tools/mermaid-preview/MermaidPreview.vue';

// MermaidPreview 用到 store.showToast（mock）；useI18n 由 tests/setup.ts 全局 mock
vi.mock('@/store/app', () => ({
  useAppStore: () => ({ showToast: vi.fn() }),
}));

describe('MermaidPreview fence stripping', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('strips ```mermaid fence from initialData into the editor textarea', async () => {
    const wrapper = mount(MermaidPreview, {
      props: { initialData: '```mermaid\nflowchart LR\n  A --> B\n```' },
    });
    await nextTick();
    const value = (wrapper.find('textarea').element as HTMLTextAreaElement).value;
    expect(value).toBe('flowchart LR\n  A --> B');
    wrapper.unmount();
  });

  it('keeps plain mermaid source unchanged in the editor', async () => {
    const wrapper = mount(MermaidPreview, {
      props: { initialData: 'flowchart LR\n  A --> B' },
    });
    await nextTick();
    const value = (wrapper.find('textarea').element as HTMLTextAreaElement).value;
    expect(value).toBe('flowchart LR\n  A --> B');
    wrapper.unmount();
  });
});
