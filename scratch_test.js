import { NumbatEngine } from './src/lib/services/NumbatEngine.ts';

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
