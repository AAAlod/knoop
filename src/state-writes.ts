// Capture input before enqueueing. Failed tasks do not poison later saves.
const pending = new Map<string, Promise<void>>();
const lastTask = new Map<string, () => Promise<void>>();
export function enqueueDraft(key: string, task: () => Promise<void>): Promise<void> {
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  pending.set(key,next);
  lastTask.set(key,task);
  void next.then(()=>{if(pending.get(key)===next){pending.delete(key);lastTask.delete(key);}},()=>{});
  return next;
}
export async function flushDrafts(key?: string): Promise<void> {
  const keys=key?[key]:[...pending.keys()];
  for(const current of keys){
    try{await pending.get(current);}catch(error){
      const retry=lastTask.get(current);if(!retry)throw error;
      await enqueueDraft(current,retry);
    }
  }
}
