<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { Command } from '@tauri-apps/plugin-shell';

const { t } = useI18n();
const store = useAppStore();

const port = ref<string>('3000');
type NetEntry = { proto: string; local: string; remote: string; state?: string; pid: number; name?: string };
const entries = ref<NetEntry[]>([]);
const log = ref<string>('');
const loading = ref(false);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } = useResizablePanel({ minFirstWidth: 260, minSecondWidth: 260, desktopBreakpoint: 768 });

const appendLog = (line: string) => {
  log.value = [line, log.value].filter(Boolean).join('\n');
};

type CommandResult = {
  stdout?: string;
  stderr?: string;
  code?: number;
};

type KillResult = {
  pid: number;
  finalCommand: string;
  finalOutput: string;
  success: boolean;
};

const parseNetEntries = (stdout: string): NetEntry[] => {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results: NetEntry[] = [];
  lines.forEach(line => {
    // TCP行带状态
    let m = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)$/);
    if (m) {
      results.push({
        proto: m[1],
        local: m[2],
        remote: m[3],
        state: m[4],
        pid: Number(m[5]),
      });
      return;
    }
    // UDP行无状态
    m = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\d+)$/);
    if (m) {
      results.push({
        proto: m[1],
        local: m[2],
        remote: m[3],
        pid: Number(m[4]),
      });
    }
  });
  return results.filter(e => e.pid > 0);
};

/** 直接以参数数组调用系统命令（不经 cmd shell，无拼接注入面）。 */
const runCommand = async (name: string, args: string[]): Promise<CommandResult> => {
  const cmd = Command.create(name, args);
  const result = await cmd.execute();
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    code: typeof result.code === 'number' ? result.code : undefined,
  };
};

/** 判断监听地址是否使用目标端口（`127.0.0.1:3000`、`[::]:3000` 均匹配，避免 `:30001` 误命中）。 */
const isListeningOnPort = (local: string, port: number): boolean =>
  new RegExp(`:${port}(?![0-9])`).test(local);

const formatCommandResult = (result: CommandResult) => {
  return [result.stdout?.trim(), result.stderr?.trim(), `code=${result.code ?? ''}`]
    .filter(Boolean)
    .join(' | ');
};

const isPidAlive = async (pid: number) => {
  try {
    const result = await runCommand('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    const stdout = result.stdout?.trim() || '';
    if (!stdout) return false;
    if (stdout.includes('没有运行的任务') || stdout.includes('No tasks are running')) return false;
    return stdout.split(/\r?\n/).some(line => line.trim().startsWith('"'));
  } catch (e) {
    appendLog(String((e as { message?: unknown } | null)?.message ?? e));
    return true;
  }
};

const terminatePid = async (pid: number): Promise<KillResult> => {
  const primaryCommand = `taskkill /F /PID ${pid}`;
  const primaryResult = await runCommand('taskkill', ['/F', '/PID', String(pid)]);
  const primarySummary = formatCommandResult(primaryResult);
  appendLog(`[PID ${pid}] ${primaryCommand}`);
  if (primarySummary) appendLog(primarySummary);

  const aliveAfterPrimary = await isPidAlive(pid);
  if (!aliveAfterPrimary) {
    return {
      pid,
      finalCommand: primaryCommand,
      finalOutput: primarySummary,
      success: true,
    };
  }

  const fallbackCommand = `wmic process where processid=${pid} call terminate`;
  const fallbackResult = await runCommand('wmic', ['process', 'where', `processid=${pid}`, 'call', 'terminate']);
  const fallbackSummary = formatCommandResult(fallbackResult);
  appendLog(`[PID ${pid}] ${fallbackCommand}`);
  if (fallbackSummary) appendLog(fallbackSummary);

  const aliveAfterFallback = await isPidAlive(pid);
  return {
    pid,
    finalCommand: fallbackCommand,
    finalOutput: fallbackSummary,
    success: !aliveAfterFallback,
  };
};

const buildKillToastMessage = (results: KillResult[]) => {
  return results.map(result => {
    const status = result.success ? t('tools.port_killer.success') : t('tools.port_killer.fail');
    const detail = result.finalOutput || t('tools.port_killer.no_output');
    return `PID ${result.pid} ${status} | ${result.finalCommand} | ${detail}`;
  }).join('\n');
};

const onScanClick = async () => {
  await findPids();
};

const findPids = async (options?: { silentToast?: boolean }) => {
  entries.value = [];
  log.value = '';
  const portNum = Number(port.value);
  if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
    store.showToast(t('tools.port_killer.invalid_port'), { type: 'warning' });
    return;
  }
  loading.value = true;
  try {
    const { stdout, stderr } = await runCommand('netstat', ['-ano', '-p', 'tcp']);
    if (stderr?.trim()) appendLog(stderr.trim());
    const tcpEntries = parseNetEntries(stdout || '').filter(e => isListeningOnPort(e.local, portNum));

    const udpResult = await runCommand('netstat', ['-ano', '-p', 'udp']);
    if (udpResult.stderr?.trim()) appendLog(udpResult.stderr.trim());
    const udpEntries = parseNetEntries(udpResult.stdout || '').filter(e => isListeningOnPort(e.local, portNum));

    const combined = [...tcpEntries, ...udpEntries];
    // 补充进程名（去重查询）
    const pidSet = Array.from(new Set(combined.map(e => e.pid)));
    const nameMap = new Map<number, string | undefined>();
    for (const pid of pidSet) {
      const info = await resolveProcessName(pid);
      nameMap.set(pid, info);
    }
    combined.forEach(e => {
      e.name = nameMap.get(e.pid);
    });

    entries.value = combined;
    if (!options?.silentToast) {
      if (combined.length === 0) {
        store.showToast(t('tools.port_killer.not_found', { port: portNum }), { type: 'info' });
      } else {
        store.showToast(t('tools.port_killer.found', { count: combined.length, port: portNum }), { type: 'success' });
      }
    }
  } catch (e) {
    appendLog(String((e as { message?: unknown } | null)?.message ?? e));
    store.showToast(t('tools.port_killer.exec_failed'), { type: 'error' });
  } finally {
    loading.value = false;
  }
};

const killAll = async () => {
  if (!entries.value.length) {
    await findPids({ silentToast: true });
    if (!entries.value.length) return;
  }
  loading.value = true;
  try {
    const uniquePids = Array.from(new Set(entries.value.map(e => e.pid)));
    const results: KillResult[] = [];
    for (const pid of uniquePids) {
      results.push(await terminatePid(pid));
    }
    const hasFailure = results.some(item => !item.success);
    store.showToast(buildKillToastMessage(results), { type: hasFailure ? 'warning' : 'success', durationMs: 5000 });
    await findPids({ silentToast: true });
  } catch (e) {
    appendLog(String((e as { message?: unknown } | null)?.message ?? e));
    store.showToast(t('tools.port_killer.kill_failed'), { type: 'error' });
  } finally {
    loading.value = false;
  }
};

/**
 * 通过 tasklist 获取进程名
 */
const resolveProcessName = async (pid: number): Promise<string | undefined> => {
  try {
    const { stdout } = await runCommand('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    if (!stdout) return undefined;
    const line = stdout.split(/\r?\n/).find(l => l.trim());
    if (!line) return undefined;
    // CSV 行格式: "Image Name","PID","Session Name","Session#","Mem Usage"
    const parts = line.split('","').map(s => s.replace(/^"|"$/g, ''));
    return parts[0];
  } catch (e) {
    appendLog(String((e as { message?: unknown } | null)?.message ?? e));
    return undefined;
  }
};

/**
 * 结束单个 PID
 */
const killOne = async (pid: number) => {
  loading.value = true;
  try {
    const result = await terminatePid(pid);
    store.showToast(buildKillToastMessage([result]), { type: result.success ? 'success' : 'warning', durationMs: 5000 });
    await findPids();
  } catch (e) {
    appendLog(String((e as { message?: unknown } | null)?.message ?? e));
    store.showToast(t('tools.port_killer.kill_failed'), { type: 'error' });
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col h-full bg-background text-foreground p-4 gap-4">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-lg font-medium">{{ t('tools.port_killer.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('tools.port_killer.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model="port"
          data-testid="port-killer-port-input"
          type="number"
          class="w-28 px-3 py-2 border border-border rounded-md bg-background"
          min="1"
          max="65535"
          :placeholder="t('tools.port_killer.port_placeholder')"
        />
        <button
          data-testid="port-killer-scan-button"
          class="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors"
          :disabled="loading"
          @click="onScanClick"
        >
          {{ loading ? t('tools.port_killer.running') : t('tools.port_killer.scan') }}
        </button>
        <button
          data-testid="port-killer-killall-button"
          class="px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          :disabled="loading"
          @click="killAll"
        >
          {{ t('tools.port_killer.kill') }}
        </button>
      </div>
    </div>

    <div ref="containerRef" class="grid grid-cols-1 md:grid-cols-[minmax(260px,var(--panel-first-width,1fr))_minmax(260px,1fr)] gap-4 flex-1 overflow-hidden" :style="{ '--panel-first-width': firstPanelWidth === null ? undefined : `${firstPanelWidth}px` }">
      <div ref="firstPanelRef" class="relative flex flex-col gap-2 min-w-[260px]">
        <h2 class="text-sm font-medium text-muted-foreground">
          {{ t('tools.port_killer.entry_list', { count: entries.length }) }}
        </h2>
        <div data-testid="port-killer-entry-list" class="flex-1 border border-border rounded-md p-3 bg-muted/20 overflow-auto text-sm">
          <div v-if="entries.length === 0" class="text-muted-foreground">
            {{ t('tools.port_killer.empty') }}
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="item in entries"
              :key="`${item.proto}-${item.local}-${item.remote}-${item.pid}`"
              data-testid="port-killer-entry-item"
              class="border border-border rounded-md bg-background px-3 py-2 flex flex-col gap-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            >
              <div class="flex items-center gap-2 text-sm font-mono">
                <span class="px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">{{ item.proto.toUpperCase() }}</span>
                <span class="break-all">{{ item.local }} → {{ item.remote }}</span>
                <span v-if="item.state" class="px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs">{{ item.state }}</span>
              </div>
              <div class="flex items-center justify-between text-sm font-mono">
                <div>
                  PID {{ item.pid }}
                  <span v-if="item.name"> - {{ item.name }}</span>
                </div>
                <button
                  data-testid="port-killer-kill-one-button"
                  class="px-3 py-1 text-xs rounded-md border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                  :disabled="loading"
                  @click="killOne(item.pid)"
                >
                  {{ t('tools.port_killer.kill_one') }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.port_killer.resize_aria')" aria-orientation="vertical" tabindex="0" @pointerdown.prevent="startResize" @keydown="handleResizeKeydown"></div>
      </div>

      <div class="flex flex-col gap-2 min-w-[260px]">
        <h2 class="text-sm font-medium text-muted-foreground">{{ t('tools.port_killer.log') }}</h2>
        <textarea
          v-model="log"
          class="flex-1 border border-border rounded-md p-3 bg-muted/20 font-mono text-xs resize-none"
          readonly
          :placeholder="t('tools.port_killer.log_placeholder')"
        ></textarea>
      </div>
    </div>
  </div>
</template>
