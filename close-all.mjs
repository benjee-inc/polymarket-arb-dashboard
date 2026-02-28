#!/usr/bin/env node
// Close all open positions by selling shares at market (FOK)
import { getMarket, placeBet } from '/data/workspace/skills/moon/lib/polymarket.mjs';
import { readFileSync, writeFileSync } from 'fs';

const stateFile = '/data/workspace/polymarket-arb/state.json';
const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
const bets = state.bets.filter(b => b.status === 'FILLED' || b.status === 'live');

console.log(`Closing ${bets.length} positions...\n`);

const results = [];

for (const bet of bets) {
  try {
    const market = await getMarket(bet.conditionId);
    
    // Resolve tokenId: YES=0, NO=1
    const tokenIdx = bet.side === 'YES' ? 0 : 1;
    const tokenId = market.clobTokenIds?.[tokenIdx];
    
    if (!tokenId) {
      console.log(`❌ ${bet.market.slice(0,50)} — no tokenId found`);
      results.push({ market: bet.market, error: 'no tokenId' });
      continue;
    }

    if (market.closed) {
      console.log(`⏭️  ${bet.market.slice(0,50)} — market closed, skip`);
      results.push({ market: bet.market, error: 'market closed' });
      continue;
    }

    const shares = bet.shares;
    // Sell amount in USDC terms — for FOK market sell, amount = USDC value we want to sell
    // The CLOB sell amount is the number of shares (each share = $1 at resolution)
    // For createAndPostMarketOrder with SELL, amount = number of outcome shares to sell
    const currentPrice = bet.side === 'YES' ? market.yesPrice : market.noPrice;
    const sellValue = shares * currentPrice;

    console.log(`📤 Selling ${shares} ${bet.side} shares of "${bet.market.slice(0,50)}"`);
    console.log(`   Current price: ${currentPrice}, est value: $${sellValue.toFixed(3)}`);

    const result = await placeBet(tokenId, "SELL", sellValue, market.negRisk, market.tickSize);
    
    console.log(`   Result: ${JSON.stringify(result).slice(0,200)}\n`);
    results.push({ market: bet.market, shares, currentPrice, sellValue, ...result });

    // Update state
    bet.status = 'closed';
    bet.exitPrice = currentPrice;
    bet.exitTimestamp = new Date().toISOString();
    bet.realizedPnl = sellValue - bet.amount;

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 1500));
  } catch (err) {
    console.log(`❌ ${bet.market.slice(0,50)} — ${err.message}\n`);
    results.push({ market: bet.market, error: err.message });
  }
}

// Save updated state
writeFileSync(stateFile, JSON.stringify(state, null, 2));
console.log('\n--- SUMMARY ---');
const closed = results.filter(r => r.success);
const failed = results.filter(r => r.error || !r.success);
console.log(`Closed: ${closed.length}/${bets.length}`);
console.log(`Failed: ${failed.length}`);
if (failed.length) console.log('Failures:', JSON.stringify(failed, null, 2));
