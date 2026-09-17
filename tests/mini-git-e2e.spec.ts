import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 1. Mock tauri plugins
const openDialogMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: any[]) => openDialogMock(...args),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// 2. Mock IPC commands
const mockValidateRepo = vi.fn();
const mockOpenSession = vi.fn();
const mockCloseSession = vi.fn();
const mockRepoState = vi.fn();
const mockListDir = vi.fn();
const mockListTrackedFiles = vi.fn();
const mockReadFileMeta = vi.fn();
const mockReadFileContent = vi.fn();
const mockReadBlobContent = vi.fn();
const mockListRefs = vi.fn();
const mockHasChanges = vi.fn();
const mockLogOpen = vi.fn();
const mockLogNext = vi.fn();
const mockLogClose = vi.fn();
const mockCommitDetail = vi.fn();
const mockStatus = vi.fn();
const mockDiffPrepare = vi.fn();
const mockSearchStart = vi.fn();
const mockSearchPoll = vi.fn();
const mockSearchCancel = vi.fn();
const mockUnpushedCommits = vi.fn();

vi.mock('@/lib/ipc/bindings', () => ({
  commands: {
    mgValidateRepo: (...args: any[]) => mockValidateRepo(...args),
    mgOpenSession: (...args: any[]) => mockOpenSession(...args),
    mgCloseSession: (...args: any[]) => mockCloseSession(...args),
    mgRepoState: (...args: any[]) => mockRepoState(...args),
    mgListDir: (...args: any[]) => mockListDir(...args),
    mgListTrackedFiles: (...args: any[]) => mockListTrackedFiles(...args),
    mgReadFileMeta: (...args: any[]) => mockReadFileMeta(...args),
    mgReadFileContent: (...args: any[]) => mockReadFileContent(...args),
    mgReadBlobContent: (...args: any[]) => mockReadBlobContent(...args),
    mgListRefs: (...args: any[]) => mockListRefs(...args),
    mgHasChanges: (...args: any[]) => mockHasChanges(...args),
    mgLogOpen: (...args: any[]) => mockLogOpen(...args),
    mgLogNext: (...args: any[]) => mockLogNext(...args),
    mgLogClose: (...args: any[]) => mockLogClose(...args),
    mgCommitDetail: (...args: any[]) => mockCommitDetail(...args),
    mgStatus: (...args: any[]) => mockStatus(...args),
    mgDiffPrepare: (...args: any[]) => mockDiffPrepare(...args),
    mgSearchStart: (...args: any[]) => mockSearchStart(...args),
    mgSearchPoll: (...args: any[]) => mockSearchPoll(...args),
    mgSearchCancel: (...args: any[]) => mockSearchCancel(...args),
    mgUnpushedCommits: (...args: any[]) => mockUnpushedCommits(...args),
    residentOpen: vi.fn(),
    residentFocus: vi.fn(),
  },
}));

import App from '@/mini-git/App.vue';
import RepoPickerView from '@/mini-git/views/RepoPickerView.vue';
import WorkspaceView from '@/mini-git/views/WorkspaceView.vue';
import FileTree from '@/mini-git/components/FileTree.vue';
import { useReposStore } from '@/mini-git/stores/repos';
import { useGitDataStore } from '@/mini-git/stores/gitdata';
import { useTabsStore } from '@/mini-git/stores/tabs';
import { useSessionStore } from '@/mini-git/stores/session';

describe('Mini-Git End-to-End User Flow Tests', () => {
  let pinia: ReturnType<typeof createPinia>;
  let router: ReturnType<typeof createRouter>;

  const setupDefaultMocks = () => {
    mockValidateRepo.mockResolvedValue({
      status: 'ok',
      data: {
        name: 'test-repo',
        path: 'C:/repos/test-repo',
        is_valid: true,
      },
    });

    mockOpenSession.mockResolvedValue({
      status: 'ok',
      data: 'session-12345',
    });

    mockCloseSession.mockResolvedValue({
      status: 'ok',
      data: null,
    });

    mockRepoState.mockResolvedValue({
      status: 'ok',
      data: {
        head_oid: 'abc1234567890abcdef1234567890abcdef1234',
        head_name: 'feature-branch',
        is_detached: false,
        state: 'Normal',
      },
    });

    mockListRefs.mockResolvedValue({
      status: 'ok',
      data: {
        local_branches: [
          { name: 'refs/heads/feature-branch', short_name: 'feature-branch', target_oid: 'abc1234', is_head: true, is_tag: false },
          { name: 'refs/heads/master', short_name: 'master', target_oid: 'def5678', is_head: false, is_tag: false },
        ],
        remote_branches: [],
        tags: [
          { name: 'refs/tags/v1.0.0', short_name: 'v1.0.0', target_oid: 'aaa1111', is_head: false, is_tag: true },
        ],
        head: { name: 'refs/heads/feature-branch', short_name: 'feature-branch', target_oid: 'abc1234', is_head: true, is_tag: false },
      },
    });

    mockListDir.mockImplementation(async (_repoId: string, relPath: string) => {
      if (relPath === '') {
        return {
          status: 'ok',
          data: [
            { name: 'src', rel_path: 'src', is_dir: true, is_submodule: false, is_symlink: false, is_ignored: false, is_tracked: true, size: 0 },
            { name: 'README.md', rel_path: 'README.md', is_dir: false, is_submodule: false, is_symlink: false, is_ignored: false, is_tracked: true, size: 1024 },
          ],
        };
      }
      if (relPath === 'src') {
        return {
          status: 'ok',
          data: [
            { name: 'components', rel_path: 'src/components', is_dir: true, is_submodule: false, is_symlink: false, is_ignored: false, is_tracked: true, size: 0 },
            { name: 'index.ts', rel_path: 'src/index.ts', is_dir: false, is_submodule: false, is_symlink: false, is_ignored: false, is_tracked: true, size: 256 },
          ],
        };
      }
      if (relPath === 'src/components') {
        return {
          status: 'ok',
          data: [
            { name: 'FileTree.vue', rel_path: 'src/components/FileTree.vue', is_dir: false, is_submodule: false, is_symlink: false, is_ignored: false, is_tracked: true, size: 512 },
          ],
        };
      }
      return { status: 'ok', data: [] };
    });

    mockListTrackedFiles.mockResolvedValue({
      status: 'ok',
      data: ['README.md', 'src/index.ts', 'src/utils.ts'],
    });

    mockReadFileMeta.mockResolvedValue({
      status: 'ok',
      data: {
        size: 1024,
        is_binary: false,
        encoding: 'UTF-8',
        is_lfs_pointer: false,
      },
    });

    mockReadFileContent.mockResolvedValue({
      status: 'ok',
      data: '# Test Project\n\nWelcome to test project.',
    });

    mockStatus.mockResolvedValue({
      status: 'ok',
      data: {
        staged: [],
        unstaged: [
          { path: 'src/index.ts', status: 'M', additions: 3, deletions: 1 },
        ],
        untracked: [
          { path: 'notes.txt', status: 'U', additions: 5, deletions: 0 },
        ],
        conflicted: [],
        total_changes: 2,
        is_clean: false,
      },
    });

    mockLogOpen.mockResolvedValue({
      status: 'ok',
      data: 'walk-999',
    });

    mockLogNext.mockResolvedValue({
      status: 'ok',
      data: {
        commits: [
          {
            oid: 'abc1234567890abcdef1234567890abcdef1234',
            short_oid: 'abc1234',
            author_name: 'Test Author',
            author_email: 'test@example.com',
            author_time: Math.floor(Date.now() / 1000) - 3600,
            committer_name: 'Test Author',
            committer_time: Math.floor(Date.now() / 1000) - 3600,
            summary: 'feat: implement initial feature',
            parent_oids: ['def5678000000000000000000000000000000000'],
          },
        ],
        has_more: false,
        traversed_count: 1,
      },
    });

    mockLogClose.mockResolvedValue({ status: 'ok', data: null });

    mockCommitDetail.mockResolvedValue({
      status: 'ok',
      data: {
        oid: 'abc1234567890abcdef1234567890abcdef1234',
        short_oid: 'abc1234',
        author_name: 'Test Author',
        author_email: 'test@example.com',
        author_time: Math.floor(Date.now() / 1000) - 3600,
        author_tz_offset: 480,
        committer_name: 'Test Author',
        committer_email: 'test@example.com',
        committer_time: Math.floor(Date.now() / 1000) - 3600,
        committer_tz_offset: 480,
        message: 'feat: implement initial feature\n\nDetailed explanation here.',
        summary: 'feat: implement initial feature',
        parent_oids: ['def5678000000000000000000000000000000000'],
        is_root: false,
        is_merge: false,
        files: [
          { path: 'src/index.ts', status: 'M', additions: 10, deletions: 2 },
        ],
      },
    });

    mockDiffPrepare.mockResolvedValue({
      status: 'ok',
      data: {
        tier: 'Tier1Full',
        source: 'working',
        rel_path: 'src/index.ts',
        old_content: 'export const a = 1;\n',
        new_content: 'export const a = 2;\nexport const b = 3;\n',
        hunks: [],
        additions: 2,
        deletions: 1,
        is_binary: false,
        old_size: 20,
        new_size: 40,
        reason: null,
        old_path: null,
      },
    });

    mockUnpushedCommits.mockResolvedValue({
      status: 'ok',
      data: {
        commits: [],
        total: 0,
        truncated: false,
      },
    });
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'picker', component: RepoPickerView },
        { path: '/workspace', name: 'workspace', component: WorkspaceView },
      ],
    });

    setupDefaultMocks();
  });

  it('E2E Flow 1: 首次启动进入 RepoPickerView，空态引导文案正常呈现', async () => {
    router.push('/');
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('暂无已登记仓库');
    expect(wrapper.text()).toContain('选择本地 Git 仓库开始审阅');
    expect(wrapper.find('button').exists()).toBe(true);
  });

  it('E2E Flow 2: 用户点击“添加仓库”选择有效 Git 仓库，顺利通过验证并进入工作台', async () => {
    openDialogMock.mockResolvedValue('C:/repos/test-repo');

    router.push('/');
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    // 点击添加仓库按钮
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('添加仓库') || b.text().includes('选择仓库'));
    expect(addBtn).toBeDefined();
    await addBtn!.trigger('click');
    await flushPromises();

    // 验证调用了 validateRepo 和 openSession
    expect(mockValidateRepo).toHaveBeenCalledWith('C:/repos/test-repo');
    expect(mockOpenSession).toHaveBeenCalledWith('C:/repos/test-repo');

    // 验证路由器跳转到 /workspace
    expect(router.currentRoute.value.path).toBe('/workspace');
    expect(router.currentRoute.value.query.path).toBe('C:/repos/test-repo');

    // 验证 Workspace 渲染了仓库名与分支名
    expect(wrapper.text()).toContain('test-repo');
    expect(wrapper.text()).toContain('feature-branch');
  });

  it('E2E Flow 3: 用户选择非 Git 目录，给出友好错误提示且不崩溃', async () => {
    openDialogMock.mockResolvedValue('C:/not-a-git-repo');
    mockValidateRepo.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'NotGitRepo', message: '该目录不是 Git 仓库' },
    });

    router.push('/');
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('添加仓库') || b.text().includes('选择仓库'));
    await addBtn!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('该目录不是 Git 仓库');
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('E2E Flow 4: 工作区完整交互（文件树、Git 面板、Diff 对比、Tab 切换、快捷键）', async () => {
    // 预置仓库并直接进入工作区
    const reposStore = useReposStore();
    await reposStore.addRepo('C:/repos/test-repo');

    router.push({ path: '/workspace', query: { path: 'C:/repos/test-repo' } });
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    const gitData = useGitDataStore();
    await gitData.refreshWorkingStatus();
    await flushPromises();

    // 1. 验证文件树加载
    expect(wrapper.text()).toContain('src');
    expect(wrapper.text()).toContain('README.md');

    // 2. 双击 README.md 文件打开内容 Tab
    const fileItem = wrapper.findAll('div').find((d) => d.text().trim() === 'README.md' && d.classes().includes('cursor-pointer'));
    if (fileItem) {
      await fileItem.trigger('dblclick');
      await flushPromises();
    }
    const tabsStore = useTabsStore();
    expect(tabsStore.tabs.some((t) => t.path === 'README.md')).toBe(true);

    // 3. 点击 Git 面板中的未提交变更文件打开 Diff（变更树里文件行只显示文件名）
    const gitPanelFile = wrapper
      .findAll('[data-testid="changes-file"]')
      .find((d) => d.text().includes('index.ts'));
    expect(gitPanelFile).toBeDefined();
    await gitPanelFile!.trigger('click');
    await flushPromises();
    expect(tabsStore.tabs.some((t) => t.path === 'src/index.ts' && t.type === 'diff')).toBe(true);

    // 4. 切换到“历史” Tab
    const historyTabBtn = wrapper.findAll('button').find((b) => b.text().includes('历史'));
    expect(historyTabBtn).toBeDefined();
    await historyTabBtn!.trigger('click');
    await flushPromises();

    // 验证历史列表中展示了 commit 信息
    expect(wrapper.text()).toContain('feat: implement initial feature');
    expect(wrapper.text()).toContain('Test Author');

    // 5. 点击提交查看详情
    const commitItem = wrapper.find('p[title*="feat: implement initial feature"]');
    expect(commitItem.exists()).toBe(true);
    await commitItem.trigger('click');
    await flushPromises();

    expect(mockCommitDetail).toHaveBeenCalledWith('session-12345', 'abc1234567890abcdef1234567890abcdef1234');

    // 6. 测试全局快捷键：Ctrl+P 打开快速查找
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }));
    await flushPromises();
    expect(wrapper.find('input[placeholder*="输入文件名"]').exists()).toBe(true);

    // 按 Esc 关闭快速查找
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('input[placeholder*="输入文件名"]').exists()).toBe(false);

    // 7. 返回仓库选择器
    const backBtn = wrapper.find('button[title*="返回仓库选择首屏"]');
    expect(backBtn.exists()).toBe(true);
    await backBtn.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/');
  });

  it('E2E Flow 5: 仓库会话状态持久化与恢复（已阅文件、展开节点、激活面板、推进游标）', async () => {
    const sessionStore = useSessionStore();
    sessionStore.initRepo('C:/repos/test-repo', 'test-repo');

    sessionStore.activeGitTab = 'history';
    sessionStore.fileCursor = 3;
    sessionStore.reviewedFiles.add('src/index.ts');
    sessionStore.expandedTreeNodes.add('src');
    sessionStore.treeWidth = 280;
    sessionStore.gitPanelHeight = 400;
    sessionStore.saveSession();

    // 模拟清空 Pinia 状态或重新进入
    const freshSessionStore = useSessionStore();
    freshSessionStore.initRepo('C:/repos/test-repo', 'test-repo');

    expect(freshSessionStore.activeGitTab).toBe('history');
    expect(freshSessionStore.fileCursor).toBe(3);
    expect(freshSessionStore.reviewedFiles.has('src/index.ts')).toBe(true);
    expect(freshSessionStore.expandedTreeNodes.has('src')).toBe(true);
    expect(freshSessionStore.treeWidth).toBe(280);
    expect(freshSessionStore.gitPanelHeight).toBe(400);
  });

  it('E2E Flow 6: 标签页操作（预览槽位复用、固定、关闭、激活）', async () => {
    const tabsStore = useTabsStore();

    // 打开未固定标签 A
    tabsStore.openTab({ path: 'a.ts', type: 'content', isPinned: false });
    expect(tabsStore.tabs).toHaveLength(1);
    expect(tabsStore.tabs[0].isPinned).toBe(false);

    // 打开未固定标签 B，复用预览槽位
    tabsStore.openTab({ path: 'b.ts', type: 'content', isPinned: false });
    expect(tabsStore.tabs).toHaveLength(1);
    expect(tabsStore.tabs[0].path).toBe('b.ts');

    // 双击或显式固定标签 B
    tabsStore.pinTab(tabsStore.tabs[0].id);
    expect(tabsStore.tabs[0].isPinned).toBe(true);

    // 打开未固定标签 C，新增未固定槽位
    tabsStore.openTab({ path: 'c.ts', type: 'content', isPinned: false });
    expect(tabsStore.tabs).toHaveLength(2);

    // 关闭标签 B
    tabsStore.closeTab(tabsStore.tabs[0].id);
    expect(tabsStore.tabs).toHaveLength(1);
    expect(tabsStore.tabs[0].path).toBe('c.ts');
  });

  it('E2E Flow 7: 仓库列表键盘导航（上下移动、回车进入）', async () => {
    mockValidateRepo.mockImplementation(async (path: string) => ({
      status: 'ok',
      data: { name: path.split('/').pop()!, path, is_valid: true },
    }));

    const reposStore = useReposStore();
    await reposStore.addRepo('C:/repos/repo-1');
    await reposStore.addRepo('C:/repos/repo-2');

    router.push('/');
    await router.isReady();

    const wrapper = mount(RepoPickerView, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    expect(reposStore.filteredRepos.length).toBe(2);
    expect(reposStore.selectedIndex).toBe(0);

    const searchInput = wrapper.find('input');
    expect(searchInput.exists()).toBe(true);

    // 按下方向键
    await searchInput.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(reposStore.selectedIndex).toBe(1);

    // 按上方向键
    await searchInput.trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    expect(reposStore.selectedIndex).toBe(0);
  });

  it('E2E Flow 8: 文件树支持多层子目录递归展开与收起 (根 -> src -> components -> FileTree.vue)', async () => {
    const reposStore = useReposStore();
    await reposStore.addRepo('C:/repos/test-repo');

    router.push({ path: '/workspace', query: { path: 'C:/repos/test-repo' } });
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    const fileTree = wrapper.findComponent(FileTree);
    expect(fileTree.exists()).toBe(true);

    // 1. 初始状态：显示根目录条目，尚未展开 src
    expect(fileTree.text()).toContain('src');
    expect(fileTree.text()).not.toContain('components');
    expect(fileTree.text()).not.toContain('FileTree.vue');

    // 2. 点击展开第 1 层目录：src
    const srcRow = fileTree.findAll('div').find((d) => d.text().trim().startsWith('src') && d.classes().includes('cursor-pointer'));
    expect(srcRow).toBeDefined();
    await srcRow!.trigger('click');
    await flushPromises();

    // 此时应展示第 2 层：components 与 index.ts
    expect(fileTree.text()).toContain('components');
    expect(fileTree.text()).toContain('index.ts');
    expect(fileTree.text()).not.toContain('FileTree.vue');

    // 3. 点击展开第 2 层目录：components (C:\ws\openToolBox\src\components)
    const componentsRow = fileTree.findAll('div').find((d) => d.text().trim().startsWith('components') && d.classes().includes('cursor-pointer'));
    expect(componentsRow).toBeDefined();
    await componentsRow!.trigger('click');
    await flushPromises();

    // 此时应成功展示第 3 层：FileTree.vue
    expect(fileTree.text()).toContain('FileTree.vue');

    // 4. 双击 FileTree.vue 打开标签页
    const fileTreeRow = fileTree.findAll('div').find((d) => d.text().trim() === 'FileTree.vue' && d.classes().includes('cursor-pointer'));
    expect(fileTreeRow).toBeDefined();
    await fileTreeRow!.trigger('dblclick');
    await flushPromises();

    const tabsStore = useTabsStore();
    expect(tabsStore.tabs.some((t) => t.path === 'src/components/FileTree.vue')).toBe(true);

    // 5. 再次点击 components 目录，能够正常收起第 3 层
    await componentsRow!.trigger('click');
    await flushPromises();
    expect(fileTree.text()).not.toContain('FileTree.vue');
    expect(fileTree.text()).toContain('components');
  });

  it('E2E Flow 9: 文件树节点右键打开菜单项（复制绝对路径、复制相对路径）', async () => {
    setupDefaultMocks();
    const reposStore = useReposStore();
    const gitDataStore = useGitDataStore();

    await reposStore.addRepo('C:/repos/test-repo');
    await gitDataStore.openRepo('C:/repos/test-repo');

    router.push('/workspace');
    await router.isReady();

    const wrapper = mount(WorkspaceView, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    const fileTree = wrapper.findComponent(FileTree);
    expect(fileTree.exists()).toBe(true);

    // Mock clipboard writeText
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    // 找到 README.md 节点并触发 contextmenu
    const readmeRow = fileTree.findAll('div').find((d) => d.text().trim() === 'README.md' && d.classes().includes('cursor-pointer'));
    expect(readmeRow).toBeDefined();

    await readmeRow!.trigger('contextmenu', {
      clientX: 200,
      clientY: 300,
    });
    await flushPromises();

    // 弹出右键菜单项 Teleport to body
    const copyBtns = document.body.querySelectorAll('button');
    const absBtn = Array.from(copyBtns).find((b) => b.textContent?.includes('复制绝对路径'));
    const relBtn = Array.from(copyBtns).find((b) => b.textContent?.includes('复制相对路径'));
    expect(absBtn).toBeDefined();
    expect(relBtn).toBeDefined();

    // 点击复制相对路径
    (relBtn as HTMLButtonElement).click();
    await flushPromises();
    expect(writeTextMock).toHaveBeenCalledWith('README.md');

    // 再次触发 contextmenu 测试复制绝对路径
    await readmeRow!.trigger('contextmenu', {
      clientX: 200,
      clientY: 300,
    });
    await flushPromises();

    const absBtn2 = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('复制绝对路径'));
    expect(absBtn2).toBeDefined();
    (absBtn2 as HTMLButtonElement).click();
    await flushPromises();
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('README.md'));
  });

  it('E2E Flow 10: 展示已提交未推送展示区（提交信息、展开变动文件、查看差异、定位历史）', async () => {
    setupDefaultMocks();
    mockUnpushedCommits.mockResolvedValue({
      status: 'ok',
      data: {
        commits: [
          {
            oid: '70242f4000000000000000000000000000000000',
            short_oid: '70242f4',
            author_name: 'Dev User',
            author_email: 'dev@example.com',
            author_time: Math.floor(Date.now() / 1000) - 600,
            committer_name: 'Dev User',
            committer_time: Math.floor(Date.now() / 1000) - 600,
            summary: 'feat: add unpushed commit feature',
            parent_oids: ['5c6c5ca000000000000000000000000000000000'],
          },
        ],
        total: 1,
        truncated: false,
      },
    });
    mockCommitDetail.mockResolvedValue({
      status: 'ok',
      data: {
        oid: '70242f4000000000000000000000000000000000',
        short_oid: '70242f4',
        author_name: 'Dev User',
        author_email: 'dev@example.com',
        author_time: Math.floor(Date.now() / 1000) - 600,
        author_tz_offset: 480,
        committer_name: 'Dev User',
        committer_email: 'dev@example.com',
        committer_time: Math.floor(Date.now() / 1000) - 600,
        committer_tz_offset: 480,
        message: 'feat: add unpushed commit feature\n\nDetailed message',
        summary: 'feat: add unpushed commit feature',
        parent_oids: ['5c6c5ca000000000000000000000000000000000'],
        is_root: false,
        is_merge: false,
        files: [
          { path: 'src/mini-git/components/GitPanel.vue', status: 'M', additions: 15, deletions: 2 },
        ],
      },
    });

    const reposStore = useReposStore();
    const gitDataStore = useGitDataStore();
    const sessionStore = useSessionStore();
    const tabsStore = useTabsStore();

    await reposStore.addRepo('C:/repos/test-repo');
    await gitDataStore.openRepo('C:/repos/test-repo');

    router.push('/workspace');
    await router.isReady();

    const wrapper = mount(WorkspaceView, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    // 1. 验证“已提交未推送”指示器与分组渲染
    expect(wrapper.text()).toContain('已提交未推送 (1)');
    expect(wrapper.text()).toContain('70242f4');
    expect(wrapper.text()).toContain('feat: add unpushed commit feature');

    // 2. 点击展开未推送提交的文件列表
    const commitRow = wrapper.findAll('div').find((d) => d.text().includes('70242f4') && d.classes().includes('cursor-pointer'));
    expect(commitRow).toBeDefined();
    await commitRow!.trigger('click');
    await flushPromises();

    // 展开后应显示提交内的变更文件：目录压缩成一行，文件名单独一行
    expect(wrapper.text()).toContain('src\\mini-git\\components');
    expect(wrapper.text()).toContain('GitPanel.vue');

    // 3. 点击该变更文件打开 Commit Diff 标签页
    const unpushedFileRow = wrapper
      .findAll('[data-testid="changes-file"]')
      .find((d) => d.text().includes('GitPanel.vue'));
    expect(unpushedFileRow).toBeDefined();
    await unpushedFileRow!.trigger('click');
    await flushPromises();

    expect(tabsStore.tabs.some((t) => t.path === 'src/mini-git/components/GitPanel.vue' && t.type === 'diff' && t.diffSource === 'commit')).toBe(true);

    // 4. 点击“历史”按钮跳转历史面板
    const toHistoryBtn = wrapper.findAll('button').find((b) => b.text().includes('历史') && b.classes().includes('border'));
    expect(toHistoryBtn).toBeDefined();
    await toHistoryBtn!.trigger('click');
    await flushPromises();

    expect(sessionStore.activeGitTab).toBe('history');
    expect(sessionStore.selectedCommitOid).toBe('70242f4000000000000000000000000000000000');
  });

  it('E2E Flow 11: 历史提交卡片右键「与本地对比」，文件按工作区当前内容比对', async () => {
    const reposStore = useReposStore();
    await reposStore.addRepo('C:/repos/test-repo');

    router.push({ path: '/workspace', query: { path: 'C:/repos/test-repo' } });
    await router.isReady();

    const wrapper = mount(WorkspaceView, {
      global: {
        plugins: [pinia, router],
      },
    });
    await flushPromises();

    // 1. 切到历史面板
    const historyTabBtn = wrapper.findAll('button').find((b) => b.text().includes('历史'));
    expect(historyTabBtn).toBeDefined();
    await historyTabBtn!.trigger('click');
    await flushPromises();

    // 2. 右键提交卡片，弹出菜单（Teleport 到 body）
    const commitCard = wrapper.find('[data-testid="commit-card"]');
    expect(commitCard.exists()).toBe(true);
    await commitCard.trigger('contextmenu');
    await flushPromises();

    const menuItem = document.querySelector('[data-testid="compare-with-local"]') as HTMLElement | null;
    expect(menuItem).not.toBeNull();

    // 3. 点「与本地对比」，菜单关闭且提交被选中
    menuItem!.click();
    await flushPromises();

    expect(document.querySelector('[data-testid="commit-context-menu"]')).toBeNull();
    expect(wrapper.text()).toContain('与本地对比中');

    // 4. 点详情里的文件，打开的是与工作区当前内容的对比
    const fileRow = wrapper.findAll('div').find(
      (d) => d.text().trim() === 'src/index.tsM' && d.classes().includes('cursor-pointer'),
    );
    expect(fileRow).toBeDefined();
    await fileRow!.trigger('click');
    await flushPromises();

    const tabsStore = useTabsStore();
    const diffTab = tabsStore.tabs.find((t) => t.type === 'diff');
    expect(diffTab?.diffSource).toBe('commit-local');
    expect(diffTab?.title).toContain('↔ 本地');

    // 后端拿到的是 commit-local: 前缀，而不是与父提交比较的 commit:
    expect(mockDiffPrepare).toHaveBeenCalledWith(
      expect.anything(),
      'commit-local:abc1234567890abcdef1234567890abcdef1234',
      'src/index.ts',
    );
  });
});


