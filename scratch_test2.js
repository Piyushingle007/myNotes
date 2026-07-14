import fs from 'fs';
import { NumbatEngine } from './src/lib/services/NumbatEngine.ts';

// Mock fetch to simulate offline
global.fetch = async () => { throw new Error('Offline!'); };
global.localStorage = { getItem: () => null, setItem: () => {} };

async function main() {
  console.log('init...');
  await NumbatEngine.init();
  console.log('resetting...');
  NumbatEngine.reset();
  console.log('interpreting 10 eur -> inr ...');
  const res = NumbatEngine.interpret('10 eur -> inr');
  console.log('Result:', res);
}
main().catch(console.error);
