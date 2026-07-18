import { useEffect } from 'react';

import {
  backButton,
  hapticFeedback,
  init,
  mainButton,
  miniApp,
  themeParams,
  viewport,
} from '@telegram-apps/sdk-react';

/** Guard: run `fn` only when a Telegram SDK method reports itself available.
 * Keeps the app functional in a plain browser during local development. */
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Not running inside Telegram (or method unsupported) — ignore.
  }
}

/**
 * Boot the Telegram SDK: mount theme/viewport/mini-app, bind their CSS variables
 * (this is what populates `--tg-theme-*`), expand the viewport, and reflect the
 * client's light/dark choice as a `.dark` class on <html> so shadcn dark variants
 * resolve. Safe to call outside Telegram — every step is capability-guarded.
 */
export function initTelegram(): void {
  safe(() => init());

  safe(() => {
    if (themeParams.mountSync.isAvailable()) themeParams.mountSync();
    if (themeParams.bindCssVars.isAvailable()) themeParams.bindCssVars();
  });
  safe(() => {
    if (miniApp.mountSync.isAvailable()) miniApp.mountSync();
    if (miniApp.bindCssVars.isAvailable()) miniApp.bindCssVars();
  });
  safe(() => {
    if (viewport.mount.isAvailable()) void viewport.mount();
    if (viewport.bindCssVars.isAvailable()) viewport.bindCssVars();
    if (viewport.expand.isAvailable()) viewport.expand();
  });

  applyColorScheme();
}

/** Toggle the `.dark` class from the resolved background luminance (works whether
 * or not the SDK exposes an explicit color-scheme signal). */
function applyColorScheme(): void {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--tg-theme-bg-color')
    .trim();
  const dark = bg ? isDarkColor(bg) : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', Boolean(dark));
}

function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Perceived luminance (ITU-R BT.601).
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

// ── Haptics ───────────────────────────────────────────────────────────────────

export const haptic = {
  impact(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    safe(() => {
      if (hapticFeedback.impactOccurred.isAvailable()) hapticFeedback.impactOccurred(style);
    });
  },
  notify(type: 'success' | 'error' | 'warning'): void {
    safe(() => {
      if (hapticFeedback.notificationOccurred.isAvailable())
        hapticFeedback.notificationOccurred(type);
    });
  },
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Show the native BackButton while this component is mounted and route its press
 * to `onBack`. Passing `undefined` hides it (top-level screens).
 */
export function useBackButton(onBack?: () => void): void {
  useEffect(() => {
    if (!onBack) return;
    let off: (() => void) | undefined;
    safe(() => {
      if (backButton.mount.isAvailable()) backButton.mount();
      if (backButton.show.isAvailable()) backButton.show();
      if (backButton.onClick.isAvailable()) off = backButton.onClick(onBack);
    });
    return () => {
      off?.();
      safe(() => {
        if (backButton.hide.isAvailable()) backButton.hide();
      });
    };
  }, [onBack]);
}

export interface MainButtonOptions {
  text: string;
  onClick: () => void;
  enabled?: boolean;
  loading?: boolean;
  visible?: boolean;
}

/**
 * Drive the native MainButton for a screen's primary action. Params and the click
 * handler are kept in sync with the options; the button is hidden on unmount.
 */
export function useMainButton({
  text,
  onClick,
  enabled = true,
  loading = false,
  visible = true,
}: MainButtonOptions): void {
  useEffect(() => {
    safe(() => {
      if (mainButton.mount.isAvailable()) mainButton.mount();
      if (mainButton.setParams.isAvailable()) {
        mainButton.setParams({
          text,
          isVisible: visible,
          isEnabled: enabled && !loading,
          isLoaderVisible: loading,
        });
      }
    });
  }, [text, enabled, loading, visible]);

  useEffect(() => {
    let off: (() => void) | undefined;
    safe(() => {
      if (mainButton.onClick.isAvailable()) off = mainButton.onClick(onClick);
    });
    return () => off?.();
  }, [onClick]);

  useEffect(
    () => () => {
      safe(() => {
        if (mainButton.setParams.isAvailable()) mainButton.setParams({ isVisible: false });
      });
    },
    [],
  );
}
