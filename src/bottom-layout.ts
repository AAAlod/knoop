const bottomSelector = ".bottom-actions,.scope-bottom,.form-bottom-actions";

// Scroll only the obscured distance; opening a menu must not jump to page top.
export function revealAboveBottom(element: HTMLElement): void {
  if (!element.isConnected) return;
  const viewport = window.visualViewport;
  const top = Math.max(viewport?.offsetTop ?? 0, document.querySelector("header")?.getBoundingClientRect().bottom ?? 0) + 8;
  const viewportBottom = Math.min(window.innerHeight, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
  const bar = document.querySelector<HTMLElement>(bottomSelector);
  const bottom = Math.min(viewportBottom, bar?.getBoundingClientRect().top ?? viewportBottom) - 8;
  const rect = element.getBoundingClientRect();
  if (bottom <= top) return;
  if (rect.height <= bottom - top) {
    if (rect.bottom > bottom) window.scrollBy(0, Math.ceil(rect.bottom - bottom));
    else if (rect.top < top) window.scrollBy(0, Math.floor(rect.top - top));
  } else if (rect.top > bottom - 48) {
    window.scrollBy(0, Math.ceil(rect.top - (bottom - 48)));
  }
}

export function bindBottomLayout(root: HTMLElement): () => void {
  const main = root.querySelector<HTMLElement>("main");
  const bar = main?.querySelector<HTMLElement>(bottomSelector);
  if (!main || !bar) return () => {};
  main.classList.add("has-bottom-actions");
  if (bar.classList.contains("form-bottom-actions")) bar.classList.toggle("single-action", bar.children.length === 1);
  bar.style.setProperty("--action-count", String(bar.querySelectorAll(":scope > button").length || 1));
  const viewport = window.visualViewport;
  let frame = 0;
  let revealFocus = false;
  const measure = () => {
    const height = viewport?.height ?? window.innerHeight;
    const offset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0));
    main.style.setProperty("--viewport-bottom", `${Math.round(offset)}px`);
    main.style.setProperty("--visible-viewport-height", `${Math.round(height)}px`);
    main.style.setProperty("--bottom-actions-height", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  };
  const schedule = (focus: boolean) => {
    revealFocus ||= focus;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
      const active = document.activeElement;
      if (revealFocus && active instanceof HTMLElement && main.contains(active) && active.matches("input:not([type=checkbox]):not([type=radio]),textarea,select")) revealAboveBottom(active);
      revealFocus = false;
    });
  };
  const resize = () => schedule(true);
  const focus = () => schedule(true);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule(false));
  observer?.observe(bar);
  window.addEventListener("resize", resize);
  viewport?.addEventListener("resize", resize);
  viewport?.addEventListener("scroll", resize);
  main.addEventListener("focusin", focus);
  measure();
  return () => {
    observer?.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    viewport?.removeEventListener("resize", resize);
    viewport?.removeEventListener("scroll", resize);
    main.removeEventListener("focusin", focus);
  };
}
