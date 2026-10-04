// A way for code with no screen to tell the screens that your rows changed.
//
// The widget's background task (headless.ts) runs in the same JavaScript as the
// app when the app is open, but outside React: it has no provider to call. This
// is the one thing they share. Nothing is queued: with no listener, the app is
// not open, and it reads its rows fresh when it starts.

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe. Returns the unsubscribe, so it can be an effect's cleanup. */
export function onRowsChangedElsewhere(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function announceRowsChanged(): void {
  for (const l of listeners) l();
}
