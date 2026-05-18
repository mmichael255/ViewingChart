'use client';

import { useEffect, useRef } from 'react';

type ShortcutHandler = () => void;

export interface ShortcutMap {
  [key: string]: ShortcutHandler;
}

function matchKey(e: KeyboardEvent, pattern: string): boolean {
  const parts = pattern.split('+');
  const key = parts.pop()!;
  const modifiers = parts;

  const ctrl = modifiers.includes('Ctrl');
  const shift = modifiers.includes('Shift');
  const alt = modifiers.includes('Alt');

  if (ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (alt !== e.altKey) return false;
  // Only enforce Shift when explicitly in the pattern
  if (shift && !e.shiftKey) return false;

  // Normalize key
  const pressedKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const patternKey = key.length === 1 ? key.toLowerCase() : key;

  if (pressedKey === patternKey) return true;

  // When Shift is in pattern, also try the shifted character
  // (e.g. pattern "]" but Shift pressed produces "}")
  if (shift) {
    const shiftMap: Record<string, string> = {
      ']': '}', '[': '{', '1': '!', '2': '@', '3': '#', '4': '$',
      '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
      '-': '_', '=': '+', ';': ':', "'": '"', ',': '<', '.': '>',
      '/': '?', '`': '~', '\\': '|',
    };
    const shifted = shiftMap[key]?.toLowerCase();
    if (shifted && pressedKey === shifted) return true;
  }

  return false;
}

/**
 * Centralized keyboard shortcut hook.
 *
 * Accepts a map where keys are shortcut patterns like:
 *   "Escape", "Delete", "/", "1", "Ctrl+b", "Ctrl+Shift+]"
 *
 * Automatically guards against firing when focus is on
 * input / textarea / select elements.
 *
 * Uses a ref internally so the listener is registered once
 * and always reads the latest handlers — no re-registration
 * on every render.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap): void {
  const ref = useRef(shortcuts);

  useEffect(() => {
    ref.current = shortcuts;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Guard: don't fire shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      for (const [pattern, fn] of Object.entries(ref.current)) {
        if (matchKey(e, pattern)) {
          e.preventDefault();
          e.stopPropagation();
          fn();
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}