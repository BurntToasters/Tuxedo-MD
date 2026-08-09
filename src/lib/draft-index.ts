import { normalizeDraftIndex } from './session';

type DraftIndexStore = {
  loadState: <T>(key: string) => Promise<T | null>;
  saveState: (key: string, value: unknown) => Promise<void>;
};

/** Serialize all draft-index writes so concurrent callers cannot clobber each other. */
let draftIndexChain: Promise<void> = Promise.resolve();

/** Add or remove a tab id from the persisted draft-index (normalized). */
export async function setDraftIndexed(
  id: string,
  keep: boolean,
  { loadState, saveState }: DraftIndexStore
): Promise<void> {
  const run = async () => {
    const index = normalizeDraftIndex((await loadState<string[]>('draft-index')) ?? []);
    const has = index.includes(id);
    if (keep && !has) await saveState('draft-index', [...index, id]);
    if (!keep && has)
      await saveState(
        'draft-index',
        index.filter((item) => item !== id)
      );
  };
  draftIndexChain = draftIndexChain.then(run, run);
  await draftIndexChain;
}
