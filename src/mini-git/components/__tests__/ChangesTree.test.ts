import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import ChangesTree from '../ChangesTree.vue';
import { useSessionStore } from '../../stores/session';
import type { ChangedFile } from '@/lib/ipc/bindings';

function file(path: string, status = 'M'): ChangedFile {
  return {
    path,
    old_path: null,
    status,
    staged_status: null,
    unstaged_status: status,
    additions: 0,
    deletions: 0,
  };
}

const files = [
  file('src/main/java/com/patpat/PmcReportRoleSaveReq.java'),
  file('src/main/java/com/patpat/DataScopeResp.java'),
  file('docs/design/scouter-data-scope.md'),
];

describe('ChangesTree', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  function mountTree(list: ChangedFile[] = files, fallbackStatus = 'M') {
    return mount(ChangesTree, {
      props: { files: list, groupKey: 'unstaged', fallbackStatus },
      global: { plugins: [pinia] },
    });
  }

  it('渲染压缩后的目录行与文件行（递归组件自引用）', () => {
    const wrapper = mountTree();
    const dirs = wrapper.findAll('[data-testid="changes-dir"]').map((d) => d.text());
    const leaves = wrapper.findAll('[data-testid="changes-file"]').map((f) => f.text());

    expect(dirs[0]).toContain('docs\\design');
    expect(dirs[0]).toContain('1 个文件');
    expect(dirs[1]).toContain('src\\main\\java\\com\\patpat');
    expect(dirs[1]).toContain('2 个文件');
    expect(leaves).toHaveLength(3);
    expect(leaves[0]).toContain('scouter-data-scope.md');
  });

  it('点击目录行折叠其子节点并记入 session', async () => {
    const session = useSessionStore();
    const wrapper = mountTree();

    await wrapper.findAll('[data-testid="changes-dir"]')[1].trigger('click');

    expect(session.collapsedChangesNodes.has('unstaged:src/main/java/com/patpat')).toBe(true);
    expect(wrapper.findAll('[data-testid="changes-file"]')).toHaveLength(1);
  });

  it('单击文件预览、双击固定', async () => {
    const wrapper = mountTree();
    const leaf = wrapper.findAll('[data-testid="changes-file"]')[0];

    await leaf.trigger('click');
    await leaf.trigger('dblclick');

    const events = wrapper.emitted('open') as Array<[ChangedFile, boolean]>;
    expect(events[0][0].path).toBe('docs/design/scouter-data-scope.md');
    expect(events[0][1]).toBe(false);
    expect(events[1][1]).toBe(true);
  });

  it('列表模式渲染完整路径，不渲染目录行', async () => {
    const session = useSessionStore();
    const wrapper = mountTree();

    session.setChangesViewMode('list');
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid="changes-dir"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('src/main/java/com/patpat/DataScopeResp.java');
  });

  it('unix 仓库路径下用正斜杠显示目录', async () => {
    const session = useSessionStore();
    const wrapper = mountTree();

    session.currentRepoPath = '/home/dev/repo';
    await wrapper.vm.$nextTick();

    const dirs = wrapper.findAll('[data-testid="changes-dir"]').map((d) => d.text());
    expect(dirs[1]).toContain('src/main/java/com/patpat');
  });

  it('冲突文件显示为 C 而非后端的 Conflicted', () => {
    const wrapper = mountTree([file('src/Foo.java', 'Conflicted')], 'C');
    expect(wrapper.find('[data-testid="changes-file"]').text()).toContain('C');
    expect(wrapper.text()).not.toContain('Conflicted');
  });
});
