import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PortKiller from '@/tools/port-killer/PortKiller.vue';
import { useAppStore } from '@/store/app';

const { executeMock, createMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: createMock,
  },
}));

const mountView = () =>
  mount(PortKiller, {
    global: {
      plugins: [createPinia()],
    },
  });

describe('端口占用清理页面', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    executeMock.mockReset();
    createMock.mockReset();
    // runCommand(name, args) —— 参数数组直接调用，不再拼 shell 字符串。
    createMock.mockImplementation((name: string, args: string[]) => ({
      execute: () => executeMock(name, args),
    }));
  });

  it('非法端口不会触发扫描命令', async () => {
    const wrapper = mountView();
    const input = wrapper.get('input');

    await input.setValue('70000');
    await wrapper.findAll('button')[0].trigger('click');

    expect(createMock).not.toHaveBeenCalled();
  });

  it('扫描端口后会展示 TCP/UDP 占用条目和进程名', async () => {
    executeMock.mockImplementation(async (name: string, args: string[]) => {
      if (name === 'netstat' && args.includes('tcp')) {
        return { stdout: 'TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234', stderr: '', code: 0 };
      }
      if (name === 'netstat' && args.includes('udp')) {
        return { stdout: 'UDP    0.0.0.0:3000    *:*    5678', stderr: '', code: 0 };
      }
      if (name === 'tasklist' && args.includes('PID eq 1234')) {
        return { stdout: '"node.exe","1234","Console","1","10,000 K"', stderr: '', code: 0 };
      }
      if (name === 'tasklist' && args.includes('PID eq 5678')) {
        return { stdout: '"python.exe","5678","Console","1","11,000 K"', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });

    const wrapper = mountView();
    await wrapper.findAll('button')[0].trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('node.exe');
    expect(wrapper.text()).toContain('python.exe');
    expect(wrapper.text()).toContain('PID 1234');
    expect(wrapper.text()).toContain('PID 5678');
  });

  it('一键结束会对每个唯一 PID 调用 taskkill', async () => {
    executeMock.mockImplementation(async (name: string, args: string[]) => {
      if (name === 'netstat' && args.includes('tcp')) {
        return { stdout: 'TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234', stderr: '', code: 0 };
      }
      if (name === 'netstat' && args.includes('udp')) {
        return { stdout: 'UDP    0.0.0.0:3000    *:*    1234', stderr: '', code: 0 };
      }
      if (name === 'tasklist' && args.includes('PID eq 1234')) {
        return { stdout: '"node.exe","1234","Console","1","10,000 K"', stderr: '', code: 0 };
      }
      if (name === 'taskkill' && args.includes('1234')) {
        return { stdout: 'SUCCESS: Sent termination signal to process.', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });

    const wrapper = mountView();
    await wrapper.findAll('button')[0].trigger('click');
    await flushPromises();
    await wrapper.findAll('button')[1].trigger('click');

    const taskkillCalls = createMock.mock.calls.filter(
      (call) => call[0] === 'taskkill' && call[1].includes('1234'),
    );
    expect(taskkillCalls.length).toBeGreaterThan(0);
  });

  it('taskkill 后验证仍存活时会升级使用 wmic，并只弹一次汇总结果 toast', async () => {
    const wrapper = mountView();
    const store = useAppStore();
    let pid5678Checked = 0;

    executeMock.mockImplementation(async (name: string, args: string[]) => {
      if (name === 'netstat' && args.includes('tcp')) {
        return { stdout: '', stderr: '', code: 0 };
      }
      if (name === 'netstat' && args.includes('udp')) {
        return { stdout: '', stderr: '', code: 0 };
      }
      if (name === 'taskkill' && args.includes('1234')) {
        return { stdout: 'taskkill done', stderr: '', code: 0 };
      }
      if (name === 'taskkill' && args.includes('5678')) {
        return { stdout: 'taskkill failed', stderr: 'access denied', code: 1 };
      }
      if (name === 'tasklist' && args.includes('PID eq 1234')) {
        return { stdout: 'INFO: No tasks are running which match the specified criteria.', stderr: '', code: 0 };
      }
      if (name === 'tasklist' && args.includes('PID eq 5678')) {
        pid5678Checked += 1;
        if (pid5678Checked === 1) {
          return { stdout: '"python.exe","5678","Console","1","11,000 K"', stderr: '', code: 0 };
        }
        return { stdout: 'INFO: No tasks are running which match the specified criteria.', stderr: '', code: 0 };
      }
      if (name === 'wmic' && args.includes('processid=5678')) {
        return { stdout: 'Method execution successful.', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });

    (wrapper.vm as unknown as { entries: Array<{ pid: number; proto: string; local: string; remote: string; name?: string }> }).entries = [
      { pid: 1234, proto: 'TCP', local: '127.0.0.1:3000', remote: '0.0.0.0:0', name: 'node.exe' },
      { pid: 5678, proto: 'TCP', local: '127.0.0.1:3000', remote: '0.0.0.0:0', name: 'python.exe' },
    ];

    await wrapper.findAll('button')[1].trigger('click');
    await flushPromises();

    expect(createMock.mock.calls.some((call) => call[0] === 'taskkill' && call[1].includes('1234'))).toBe(true);
    expect(createMock.mock.calls.some((call) => call[0] === 'taskkill' && call[1].includes('5678'))).toBe(true);
    expect(createMock.mock.calls.some((call) => call[0] === 'wmic' && call[1].includes('processid=5678'))).toBe(true);
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0]?.message).toContain('PID 1234');
    expect(store.toasts[0]?.message).toContain('taskkill /F /PID 1234');
    expect(store.toasts[0]?.message).toContain('PID 5678');
    expect(store.toasts[0]?.message).toContain('wmic process where processid=5678 call terminate');
  });

  it('单个结束按钮执行后会刷新列表', async () => {
    let scanned = false;
    executeMock.mockImplementation(async (name: string, args: string[]) => {
      if (name === 'netstat' && args.includes('tcp')) {
        if (!scanned) {
          scanned = true;
          return { stdout: 'TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      }
      if (name === 'netstat' && args.includes('udp')) {
        return { stdout: '', stderr: '', code: 0 };
      }
      if (name === 'tasklist' && args.includes('PID eq 1234')) {
        return { stdout: '"node.exe","1234","Console","1","10,000 K"', stderr: '', code: 0 };
      }
      if (name === 'taskkill' && args.includes('1234')) {
        return { stdout: 'SUCCESS', stderr: '', code: 0 };
      }
      if (name === 'wmic' && args.includes('1234')) {
        return { stdout: '', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });

    const wrapper = mountView();
    await wrapper.findAll('button')[0].trigger('click');
    await flushPromises();
    await wrapper.findAll('button').find((item) => item.text().includes('tools.port_killer.kill_one'))!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('tools.port_killer.empty');
  });

  it('扫描异常时会回显日志区域', async () => {
    executeMock.mockRejectedValueOnce(new Error('scan failed'));

    const wrapper = mountView();
    await wrapper.findAll('button')[0].trigger('click');
    await flushPromises();

    expect(wrapper.find('textarea').element.value).toContain('scan failed');
  });
});
