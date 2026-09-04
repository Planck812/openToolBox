import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CurlRunner from '../CurlRunner.vue';
import type { CurlSavedItem } from '../curl-model';

const mocks = vi.hoisted(() => ({
  loadCurlItems: vi.fn(),
  saveCurlItems: vi.fn(),
  showToast: vi.fn(),
  createCommand: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('../curl-storage', () => ({
  loadCurlItems: mocks.loadCurlItems,
  saveCurlItems: mocks.saveCurlItems,
}));

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ showToast: mocks.showToast }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: { create: mocks.createCommand },
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: mocks.writeText,
}));

const savedItem: CurlSavedItem = {
  request: {
    id: 'saved-request',
    name: 'Existing request',
    method: 'PUT',
    url: 'https://api.example.com/original',
    headers: [{ id: 'original-header', key: 'X-Original', value: 'original-value', enabled: true }],
    body: '{"original":true}',
    followRedirects: false,
    verifySsl: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  lastResponse: {
    status: 200,
    statusText: 'OK',
    headers: 'content-type: application/json',
    body: '{"old":true}',
    timeMs: 20,
    size: 12,
    timestamp: '2026-01-02T00:00:00.000Z',
  },
};

const secondSavedItem: CurlSavedItem = {
  ...savedItem,
  request: {
    ...savedItem.request,
    id: 'second-saved-request',
    name: 'Second request',
    url: 'https://api.example.com/second',
  },
  lastResponse: null,
};

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const importCommand = "curl -X POST https://api.example.com/imported -H 'X-Import: fresh-value' --data-raw '{\"name\":\"Ada\"}'";

const mountCurlRunner = () => mount(CurlRunner, { attachTo: document.body });

const openAndConfirmImport = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get('[data-testid="curl-import-button"]').trigger('click');
  await wrapper.get('[data-testid="curl-import-input"]').setValue(importCommand);
  await wrapper.get('[data-testid="curl-import-confirm"]').trigger('click');
  await flushPromises();
};

describe('CurlRunner request import', () => {
  beforeEach(() => {
    mocks.loadCurlItems.mockReset();
    mocks.saveCurlItems.mockReset().mockResolvedValue(undefined);
    mocks.showToast.mockReset();
    mocks.createCommand.mockReset();
    mocks.writeText.mockReset();
  });

  it('imports over a saved request as a new persisted item without changing the original', async () => {
    const originalSnapshot = JSON.parse(JSON.stringify(savedItem)) as CurlSavedItem;
    mocks.loadCurlItems.mockResolvedValue([savedItem]);
    const wrapper = mountCurlRunner();
    await flushPromises();

    await openAndConfirmImport(wrapper);

    expect(mocks.saveCurlItems).toHaveBeenCalledTimes(1);
    const persistedItems = mocks.saveCurlItems.mock.calls[0][0] as CurlSavedItem[];
    expect(persistedItems).toHaveLength(2);

    const [importedItem, originalItem] = persistedItems;
    expect(importedItem.request.id).not.toBe(savedItem.request.id);
    expect(importedItem.request).toMatchObject({
      name: '',
      method: 'POST',
      url: 'https://api.example.com/imported',
      body: '{"name":"Ada"}',
      followRedirects: true,
      verifySsl: true,
    });
    expect(importedItem.request.headers).toEqual([
      expect.objectContaining({ key: 'X-Import', value: 'fresh-value', enabled: true }),
    ]);
    expect(importedItem.lastResponse).toBeNull();
    expect(originalItem).toEqual(originalSnapshot);
    expect(savedItem).toEqual(originalSnapshot);

    expect((wrapper.get('[data-testid="curl-request-url"]').element as HTMLInputElement).value)
      .toBe('https://api.example.com/imported');
    expect(wrapper.get(`[data-testid="curl-saved-request-${importedItem.request.id}"]`).classes()).toContain('border-primary');
    expect(wrapper.find('[data-testid="curl-import-input"]').exists()).toBe(false);
    expect(mocks.showToast).toHaveBeenCalledWith('tools.curl_runner.imported_as_new', { type: 'success' });
    wrapper.unmount();
  });

  it('prevents a double click from creating or saving an imported request twice', async () => {
    const pendingSave = createDeferred<void>();
    mocks.loadCurlItems.mockResolvedValue([savedItem]);
    mocks.saveCurlItems.mockReturnValue(pendingSave.promise);
    const wrapper = mountCurlRunner();
    await flushPromises();

    await wrapper.get('[data-testid="curl-import-button"]').trigger('click');
    await wrapper.get('[data-testid="curl-import-input"]').setValue(importCommand);
    const confirmButton = wrapper.get('[data-testid="curl-import-confirm"]');
    await confirmButton.trigger('click');
    await confirmButton.trigger('click');

    expect(confirmButton.attributes('disabled')).toBeDefined();
    expect(mocks.saveCurlItems).toHaveBeenCalledTimes(1);
    pendingSave.resolve();
    await flushPromises();

    expect(wrapper.findAll('[data-testid^="curl-saved-request-"]')).toHaveLength(2);
    expect(mocks.saveCurlItems).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('does not let a completed request overwrite a newly imported request response', async () => {
    const pendingExecution = createDeferred<{ stdout: string; stderr: string }>();
    const command = { execute: vi.fn(() => pendingExecution.promise) };
    mocks.loadCurlItems.mockResolvedValue([savedItem]);
    mocks.createCommand.mockReturnValue(command);
    const wrapper = mountCurlRunner();
    await flushPromises();

    await wrapper.get('[data-testid="curl-send-button"]').trigger('click');
    expect(command.execute).toHaveBeenCalledTimes(1);

    await openAndConfirmImport(wrapper);
    expect((wrapper.get('[data-testid="curl-request-url"]').element as HTMLInputElement).value)
      .toBe('https://api.example.com/imported');

    pendingExecution.resolve({
      stdout: 'HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\nA response',
      stderr: '',
    });
    await flushPromises();

    const persistedItems = mocks.saveCurlItems.mock.calls[mocks.saveCurlItems.mock.calls.length - 1][0] as CurlSavedItem[];
    const originalItem = persistedItems.find((item) => item.request.id === savedItem.request.id);
    const importedItem = persistedItems.find((item) => item.request.url === 'https://api.example.com/imported');
    expect(originalItem?.lastResponse?.body).toBe('A response');
    expect(importedItem?.lastResponse).toBeNull();
    expect(wrapper.text()).not.toContain('A response');
    wrapper.unmount();
  });

  it('serializes response and rollback writes so a failed imported request cannot reappear on disk', async () => {
    const pendingExecution = createDeferred<{ stdout: string; stderr: string }>();
    const pendingImportSave = createDeferred<void>();
    const pendingResponseSave = createDeferred<void>();
    const command = { execute: vi.fn(() => pendingExecution.promise) };
    mocks.loadCurlItems.mockResolvedValue([savedItem]);
    mocks.createCommand.mockReturnValue(command);
    mocks.saveCurlItems
      .mockImplementationOnce(() => pendingImportSave.promise)
      .mockImplementationOnce(() => pendingResponseSave.promise)
      .mockResolvedValueOnce(undefined);
    const wrapper = mountCurlRunner();
    await flushPromises();

    await wrapper.get('[data-testid="curl-send-button"]').trigger('click');
    await wrapper.get('[data-testid="curl-import-button"]').trigger('click');
    await wrapper.get('[data-testid="curl-import-input"]').setValue(importCommand);
    await wrapper.get('[data-testid="curl-import-confirm"]').trigger('click');
    expect(mocks.saveCurlItems).toHaveBeenCalledTimes(1);

    pendingExecution.resolve({
      stdout: 'HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\nA response',
      stderr: '',
    });
    await flushPromises();
    expect(mocks.saveCurlItems).toHaveBeenCalledTimes(1);

    pendingImportSave.reject(new Error('import storage unavailable'));
    await flushPromises();
    expect(mocks.saveCurlItems).toHaveBeenCalledTimes(2);
    const responseSnapshot = mocks.saveCurlItems.mock.calls[1][0] as CurlSavedItem[];
    expect(responseSnapshot.map((item) => item.request.url)).toEqual([
      'https://api.example.com/imported',
      'https://api.example.com/original',
    ]);
    expect(responseSnapshot.find((item) => item.request.id === savedItem.request.id)?.lastResponse?.body).toBe('A response');

    pendingResponseSave.resolve();
    await flushPromises();
    expect(mocks.saveCurlItems).toHaveBeenCalledTimes(3);
    const compensationSnapshot = mocks.saveCurlItems.mock.calls[2][0] as CurlSavedItem[];
    expect(compensationSnapshot).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({ id: savedItem.request.id }),
        lastResponse: expect.objectContaining({ body: 'A response' }),
      }),
    ]);
    expect(mocks.showToast).toHaveBeenCalledWith('tools.curl_runner.save_failed', { type: 'error' });
    expect(mocks.showToast).not.toHaveBeenCalledWith('tools.curl_runner.imported_as_new', { type: 'success' });
    wrapper.unmount();
  });

  it('keeps a later request selection when an imported request fails to save', async () => {
    const pendingSave = createDeferred<void>();
    mocks.loadCurlItems.mockResolvedValue([savedItem, secondSavedItem]);
    mocks.saveCurlItems.mockReturnValue(pendingSave.promise);
    const wrapper = mountCurlRunner();
    await flushPromises();

    await wrapper.get('[data-testid="curl-import-button"]').trigger('click');
    await wrapper.get('[data-testid="curl-import-input"]').setValue(importCommand);
    await wrapper.get('[data-testid="curl-import-confirm"]').trigger('click');
    await wrapper.get('[data-testid="curl-saved-request-second-saved-request"]').trigger('click');
    pendingSave.reject(new Error('storage unavailable'));
    await flushPromises();

    expect(wrapper.findAll('[data-testid^="curl-saved-request-"]')).toHaveLength(2);
    expect(wrapper.get('[data-testid="curl-saved-request-second-saved-request"]').classes()).toContain('border-primary');
    expect((wrapper.get('[data-testid="curl-request-url"]').element as HTMLInputElement).value)
      .toBe('https://api.example.com/second');
    expect(wrapper.find('[data-testid="curl-import-input"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('restores the saved request when persisting the imported item fails', async () => {
    mocks.loadCurlItems.mockResolvedValue([savedItem]);
    mocks.saveCurlItems.mockRejectedValue(new Error('storage unavailable'));
    const wrapper = mountCurlRunner();
    await flushPromises();

    await openAndConfirmImport(wrapper);

    expect(mocks.saveCurlItems).toHaveBeenCalledTimes(2);
    expect(mocks.saveCurlItems.mock.calls[1][0]).toEqual([savedItem]);
    expect(wrapper.findAll('[data-testid^="curl-saved-request-"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="curl-saved-request-saved-request"]').classes()).toContain('border-primary');
    expect((wrapper.get('[data-testid="curl-request-url"]').element as HTMLInputElement).value)
      .toBe('https://api.example.com/original');
    expect(wrapper.find('[data-testid="curl-import-input"]').exists()).toBe(true);
    expect(mocks.showToast).toHaveBeenCalledWith('tools.curl_runner.save_failed', { type: 'error' });
    expect(mocks.showToast).not.toHaveBeenCalledWith('tools.curl_runner.imported_as_new', { type: 'success' });
    wrapper.unmount();
  });

  it('keeps importing into an unsaved request as a dirty form change without persisting', async () => {
    mocks.loadCurlItems.mockResolvedValue([]);
    const wrapper = mountCurlRunner();
    await flushPromises();

    await openAndConfirmImport(wrapper);

    expect(mocks.saveCurlItems).not.toHaveBeenCalled();
    expect((wrapper.get('[data-testid="curl-request-url"]').element as HTMLInputElement).value)
      .toBe('https://api.example.com/imported');
    expect(wrapper.text()).toContain('tools.curl_runner.unsaved');
    expect(mocks.showToast).toHaveBeenCalledWith('tools.curl_runner.imported', { type: 'success' });
    wrapper.unmount();
  });
});
