export const SAVE_BEFORE_LEAVE = "portal:save-before-leave";
export interface PendingSave {
  tasks: Promise<boolean>[];
}
export async function saveBeforeLeaving(): Promise<boolean> {
  const detail: PendingSave = { tasks: [] };
  window.dispatchEvent(new CustomEvent(SAVE_BEFORE_LEAVE, { detail }));
  return (await Promise.all(detail.tasks)).every(Boolean);
}
