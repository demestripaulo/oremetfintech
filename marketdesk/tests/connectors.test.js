// Tests for the external connectors module.
// Validates graceful degradation when API keys or upstreams are unavailable.
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFearGreedIndex,
  getCoinGeckoSentiment,
  getOnChainPanel,
  getExternalIntelligence,
} from '../cloudflare/src/connectors.js';

test('getFearGreedIndex returns an object with value or error (never throws)', async () => {
  const result = await getFearGreedIndex();
  assert.ok(typeof result === 'object' && result !== null);
  const hasValue = typeof result.value === 'number';
  const hasError = typeof result.error === 'string';
  assert.ok(hasValue || hasError, 'Must have either value or error field');
});

test('getCoinGeckoSentiment returns an object with sentimentUp or error (never throws)', async () => {
  const result = await getCoinGeckoSentiment('bitcoin');
  assert.ok(typeof result === 'object' && result !== null);
  const hasSentiment = typeof result.sentimentUp === 'number';
  const hasError = typeof result.error === 'string';
  assert.ok(hasSentiment || hasError, 'Must have either sentimentUp or error field');
});

test('getOnChainPanel degrades gracefully without Glassnode API key', async () => {
  const result = await getOnChainPanel(undefined);
  assert.ok(typeof result === 'object');
  assert.ok('activeAddresses' in result);
  assert.ok('exchangeNetflow' in result);
  assert.equal(result.activeAddresses.error, 'GLASSNODE_API_KEY não configurada');
  assert.equal(result.exchangeNetflow.error, 'GLASSNODE_API_KEY não configurada');
});

test('getExternalIntelligence returns the expected shape (never throws)', async () => {
  const result = await getExternalIntelligence({ GLASSNODE_API_KEY: undefined });
  assert.ok(typeof result === 'object');
  assert.ok('fearGreed' in result);
  assert.ok('sentiment' in result);
  assert.ok('onChain' in result);
});
