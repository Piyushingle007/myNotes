import { parseHtmlMetadata, generateHtmlNote } from '../stores/appState.svelte';

export async function runTransactionAddTest() {
  console.log('--- STARTING PROGRAMMATIC TRANSACTION ADDITION VERIFICATION TEST ---');

  const mockNoteMeta = {
    title: 'Test Note',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    notebook: 'General'
  };

  const initialHtml = `
    <html>
      <head>
        <meta name="title" content="Test Note">
        <meta name="created" content="${mockNoteMeta.created}">
        <meta name="modified" content="${mockNoteMeta.modified}">
        <meta name="notebook" content="${mockNoteMeta.notebook}">
      </head>
      <body>
        <p>Before block content</p>
        <div data-type="metrics" data-id="box_test_1" data-metrics="[]" data-title="Monthly Budget"></div>
        <p>After block content</p>
      </body>
    </html>
  `;

  // Helper helper to simulate the programmatic addition flow
  function addTransaction(
    html: string,
    boxId: string,
    desc: string,
    amount: number,
    type: 'expense' | 'inflow',
    tagIds: string[]
  ): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const block = doc.querySelector(`div[data-type="metrics"][data-id="${boxId}"], div[data-type="metrics"]#${boxId}`);
    if (!block) {
      throw new Error(`Calculation box with ID "${boxId}" not found`);
    }

    const metricsDataAttr = block.getAttribute('data-metrics');
    let rows: any[] = [];
    if (metricsDataAttr) {
      try {
        rows = JSON.parse(metricsDataAttr);
      } catch {
        rows = []; // Safe fallback on corrupt json
      }
    }

    const amountSign = type === 'expense' ? ` -${amount}` : ` +${amount}`;
    const fullLabel = `${desc.trim()}${amountSign}`;

    const newRow = {
      id: 'test_row_id_' + Math.random().toString(36).substring(2),
      label: fullLabel,
      checked: false,
      tagIds: [...tagIds]
    };

    rows.push(newRow);
    block.setAttribute('data-metrics', JSON.stringify(rows));

    const parsedMeta = parseHtmlMetadata(html);
    parsedMeta.meta.modified = new Date().toISOString();
    return generateHtmlNote(parsedMeta.meta, doc.body.innerHTML);
  }

  // Test 1: Successful programmatic addition (Expense)
  console.log('Running Test 1: Add negative transaction (expense)...');
  const step1Html = addTransaction(initialHtml, 'box_test_1', 'Groceries', 50.25, 'expense', ['tag_food']);
  
  const doc1 = new DOMParser().parseFromString(step1Html, 'text/html');
  const block1 = doc1.querySelector('div[data-type="metrics"]');
  if (!block1) throw new Error('Test 1 failed: Metrics block not found in output');
  
  const rows1 = JSON.parse(block1.getAttribute('data-metrics') || '[]');
  if (rows1.length !== 1) throw new Error(`Test 1 failed: Expected 1 row, found ${rows1.length}`);
  if (rows1[0].label !== 'Groceries -50.25') throw new Error(`Test 1 failed: Expected label "Groceries -50.25", got "${rows1[0].label}"`);
  if (!rows1[0].tagIds.includes('tag_food')) throw new Error('Test 1 failed: Missing category tag tag_food');
  console.log('Test 1 passed successfully!');

  // Test 2: Successful programmatic addition (Inflow)
  console.log('Running Test 2: Add positive transaction (inflow)...');
  const step2Html = addTransaction(step1Html, 'box_test_1', 'Refund', 15.00, 'inflow', ['tag_refund', 'tag_misc']);
  
  const doc2 = new DOMParser().parseFromString(step2Html, 'text/html');
  const block2 = doc2.querySelector('div[data-type="metrics"]');
  if (!block2) throw new Error('Test 2 failed: Metrics block not found in output');
  
  const rows2 = JSON.parse(block2.getAttribute('data-metrics') || '[]');
  if (rows2.length !== 2) throw new Error(`Test 2 failed: Expected 2 rows, found ${rows2.length}`);
  if (rows2[1].label !== 'Refund +15') throw new Error(`Test 2 failed: Expected label "Refund +15", got "${rows2[1].label}"`);
  if (rows2[1].tagIds.length !== 2) throw new Error('Test 2 failed: Expected 2 category tags on second row');
  console.log('Test 2 passed successfully!');

  // Test 3: Resilience to corrupted JSON in data-metrics attribute
  console.log('Running Test 3: Verify resilience on corrupted data-metrics attribute...');
  const corruptedHtml = `
    <html>
      <body>
        <div data-type="metrics" data-id="box_test_corrupted" data-metrics="{corrupted_json_string}"></div>
      </body>
    </html>
  `;
  const step3Html = addTransaction(corruptedHtml, 'box_test_corrupted', 'Resilience check', 10.0, 'expense', []);
  const doc3 = new DOMParser().parseFromString(step3Html, 'text/html');
  const block3 = doc3.querySelector('div[data-type="metrics"]');
  if (!block3) throw new Error('Test 3 failed: Metrics block not found');
  
  const rows3 = JSON.parse(block3.getAttribute('data-metrics') || '[]');
  if (rows3.length !== 1) throw new Error(`Test 3 failed: Expected 1 row after recovering from corrupt JSON, found ${rows3.length}`);
  if (rows3[0].label !== 'Resilience check -10') throw new Error(`Test 3 failed: Incorrect recovered row label "${rows3[0].label}"`);
  console.log('Test 3 passed successfully!');

  console.log('--- ALL PROGRAMMATIC TRANSACTION ADDITION TESTS PASSED SUCCESSFULLY! ---');
}
