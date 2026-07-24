export type Platform = 'web' | 'tauri-desktop' | 'tauri-mobile';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export function isMobileApp(): boolean {
  if (typeof window === 'undefined') return false;
  const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
  const isTauriMobile = isTauri() && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  return isCapacitor || isTauriMobile;
}

export function isWeb(): boolean {
  return !isTauri() && !isMobileApp();
}

export function getPlatform(): Platform {
  if (isTauri()) {
    return isMobileApp() ? 'tauri-mobile' : 'tauri-desktop';
  }
  return 'web';
}
