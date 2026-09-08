"use client";

import { useEffect } from "react";

export type NavKey = "j" | "k" | "e" | "s" | "o" | "Enter";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest("input, textarea, select, [contenteditable=true], [role=combobox]") !== null;
}

/**
 * Inbox shortcuts, registered once per page. Ignored while typing in a field or while a
 * menu/select is open (those own their own keyboard handling).
 */
export function useKeyboardNav(handlers: Partial<Record<NavKey, () => void>>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditable(event.target)) return;
      const handler = handlers[event.key as NavKey];
      if (!handler) return;
      event.preventDefault();
      handler();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handlers, enabled]);
}
