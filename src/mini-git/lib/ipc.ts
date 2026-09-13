import { commands, type MiniGitError } from '@/lib/ipc/bindings';

export class MiniGitIpcError extends Error {
  code: string;
  constructor(err: MiniGitError) {
    super(err.message);
    this.name = 'MiniGitIpcError';
    this.code = err.code;
  }
}

/**
 * Unwraps a Specta result: returns `data` on success, or throws MiniGitIpcError on failure.
 */
export async function unwrap<T>(promise: Promise<{ status: 'ok'; data: T } | { status: 'error'; error: MiniGitError }>): Promise<T> {
  const res = await promise;
  if (res.status === 'ok') {
    return res.data;
  }
  throw new MiniGitIpcError(res.error);
}

export const gitIpc = {
  validateRepo: (path: string) => unwrap(commands.mgValidateRepo(path)),
  openSession: (path: string) => unwrap(commands.mgOpenSession(path)),
  closeSession: (repoId: string) => unwrap(commands.mgCloseSession(repoId)),
  getRepoState: (repoId: string) => unwrap(commands.mgRepoState(repoId)),
  listDir: (repoId: string, relPath: string) => unwrap(commands.mgListDir(repoId, relPath)),
  listTrackedFiles: (repoId: string) => unwrap(commands.mgListTrackedFiles(repoId)),
  readFileMeta: (repoId: string, relPath: string) => unwrap(commands.mgReadFileMeta(repoId, relPath)),
  readFileContent: (repoId: string, relPath: string) => unwrap(commands.mgReadFileContent(repoId, relPath)),
  readBlobContent: (repoId: string, oid: string, relPath: string) => unwrap(commands.mgReadBlobContent(repoId, oid, relPath)),
  listRefs: (repoId: string) => unwrap(commands.mgListRefs(repoId)),
  hasChanges: (repoId: string) => unwrap(commands.mgHasChanges(repoId)),
  logOpen: (repoId: string, filter: { refname: string | null; author_contains: string | null }) => unwrap(commands.mgLogOpen(repoId, filter)),
  logNext: (walkId: string, limit: number) => unwrap(commands.mgLogNext(walkId, limit)),
  logClose: (walkId: string) => unwrap(commands.mgLogClose(walkId)),
  commitDetail: (repoId: string, oid: string) => unwrap(commands.mgCommitDetail(repoId, oid)),
  status: (repoId: string) => unwrap(commands.mgStatus(repoId)),
  diffPrepare: (repoId: string, source: string, relPath: string) => unwrap(commands.mgDiffPrepare(repoId, source, relPath)),
  searchStart: (repoId: string, query: { text: string; refname: string | null; author_contains: string | null }) => unwrap(commands.mgSearchStart(repoId, query)),
  searchPoll: (searchId: string) => unwrap(commands.mgSearchPoll(searchId)),
  searchCancel: (searchId: string) => unwrap(commands.mgSearchCancel(searchId)),
  residentOpen: (id: string) => commands.residentOpen(id),
  residentFocus: (id: string) => commands.residentFocus(id),
};
