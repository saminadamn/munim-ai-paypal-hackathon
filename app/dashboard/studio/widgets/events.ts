// One browser event for "Munim changed something": an approval, a rejection, a proposal or a run.
// The custom widgets refetch on it, and the dashboard refreshes Studio's data so grids and charts
// over agent_actions catch up.

export const MUNIM_CHANGED = 'munim:changed';

export const notifyMunimChanged = () => window.dispatchEvent(new Event(MUNIM_CHANGED));

export function onMunimChanged(listener: () => void) {
  window.addEventListener(MUNIM_CHANGED, listener);
  return () => window.removeEventListener(MUNIM_CHANGED, listener);
}
