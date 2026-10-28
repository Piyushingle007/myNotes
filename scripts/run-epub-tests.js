import { createServer } from 'vite';

// Polyfill minimal browser globals for Node SSR test runner
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

async function run() {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    console.log('Running EPUB test suite via Vite SSR Environment...\n');
    const testModule = await server.ssrLoadModule('/tests/epub-suite.ts');
    await testModule.runSuite();
    console.log('\n=============================================');
    console.log('🎉 ALL EPUB READER TESTS PASSED SUCCESSFULLY!');
    console.log('=============================================');
  } catch (err) {
    console.error('Test Suite Failed:', err);
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}

run();
