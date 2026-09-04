import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apply_env_write, preview_env_delete } from '../env-shell';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('env-shell delete commands', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('previews and applies deletion with the expected IPC payloads', async () => {
    invoke
      .mockResolvedValueOnce({ previewId: 'delete-preview' })
      .mockResolvedValueOnce({ ok: true, message: 'deleted', warnings: [] });

    await preview_env_delete('MY_APP_HOME');
    await apply_env_write('delete-preview');

    expect(invoke).toHaveBeenNthCalledWith(1, 'preview_env_delete', {
      request: { key: 'MY_APP_HOME' },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'apply_env_write', {
      request: { previewId: 'delete-preview' },
    });
  });
});
