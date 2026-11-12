/**
 * The focus fallback (spec 0009t): on the next animation frame, when focus was lost to `<body>`
 * (the focused control was removed or disabled), move it to `<main id="main">` without scrolling.
 * Focus that is anywhere else by then is left alone.
 */
export function focusMainIfLost(): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    document.getElementById('main')?.focus({ preventScroll: true });
  });
}
