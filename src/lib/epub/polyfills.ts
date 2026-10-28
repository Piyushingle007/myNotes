/**
 * ECMAScript Polyfills for environments running Chromium < 117
 * (e.g., Electron 26.2.2 which embeds Chromium 116, and older Android System WebViews).
 */

if (typeof (Object as any).groupBy !== 'function') {
  (Object as any).groupBy = function <T, K extends PropertyKey>(
    items: Iterable<T>,
    callback: (item: T, index: number) => K
  ): Record<K, T[]> {
    const result = Object.create(null) as Record<K, T[]>;
    if (!items) return result;
    let i = 0;
    for (const item of Array.from(items)) {
      const key = callback(item, i++);
      if (key in result) {
        result[key].push(item);
      } else {
        result[key] = [item];
      }
    }
    return result;
  };
}

if (typeof (Map as any).groupBy !== 'function') {
  (Map as any).groupBy = function <T, K>(
    items: Iterable<T>,
    callback: (item: T, index: number) => K
  ): Map<K, T[]> {
    const result = new Map<K, T[]>();
    if (!items) return result;
    let i = 0;
    for (const item of Array.from(items)) {
      const key = callback(item, i++);
      if (result.has(key)) {
        result.get(key)!.push(item);
      } else {
        result.set(key, [item]);
      }
    }
    return result;
  };
}

export {};
