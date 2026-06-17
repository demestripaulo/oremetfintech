import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BTC_CORRELATED_STOCKS, getDanelfinPanel } from '../cloudflare/src/connectors.js';

test('Danelfin panel degrades clearly when the API key is missing', async () => {
  const panel = await getDanelfinPanel(undefined);

  assert.equal(panel.configured, false);
  assert.deepEqual(panel.tickers, BTC_CORRELATED_STOCKS);
  assert.equal(panel.scores.length, BTC_CORRELATED_STOCKS.length);
  assert.ok(panel.message.includes('Danelfin API key não configurada'));
  assert.ok(panel.note.includes('Nenhum score foi estimado'));
  assert.ok(panel.scores.every((score) => score.unavailable && score.error));
});
