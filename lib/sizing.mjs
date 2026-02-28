// sizing.mjs — Dynamic position sizing & partial sell engine
// All sizing is percentage-based, scales with bankroll automatically

import { readFileSync, writeFileSync } from 'fs';

const STATE_FILE = '/data/workspace/polymarket-arb/state.json';

export function getState() {
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

export function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Get current bankroll (USDC balance + value of open positions)
 */
export function getBankroll(state) {
  const cash = state.bankroll || 0;
  const deployed = (state.bets || []).reduce((sum, b) => sum + (b.amount || 0), 0);
  return { cash, deployed, total: cash + deployed };
}

// ─── STRATEGY CONFIGS ───────────────────────────────────────────────────────

export const STRATEGY_A = {
  name: 'strategy_a',
  label: 'News Arbitrage',
  priceRange: [0.85, 0.98],       // Accept 85-98¢ (wider than before)
  takeProfit: 0.97,                // Exit at 97¢
  stopLoss: 0.03,                  // -3% stop
  maxHoldHours: 48,                // 2 day max hold

  // Dynamic sizing: % of bankroll based on edge size
  sizing: {
    tiers: [
      { minEdge: 0.02, maxEdge: 0.04, pctOfBankroll: 0.08 },  // 2-4% edge → 8% of bankroll
      { minEdge: 0.04, maxEdge: 0.07, pctOfBankroll: 0.12 },  // 4-7% edge → 12% of bankroll
      { minEdge: 0.07, maxEdge: 1.00, pctOfBankroll: 0.15 },  // 7%+ edge → 15% of bankroll
    ],
    absoluteMin: 1.0,     // Never bet less than $1 (CLOB minimum)
    maxPctOfBankroll: 0.15, // Hard cap: never more than 15% on one trade
  },

  // Partial sell levels (sell portions as price approaches target)
  partialSells: [
    { price: 0.94, pctOfPosition: 0.25 },  // Sell 25% at 94¢
    { price: 0.96, pctOfPosition: 0.50 },  // Sell 50% at 96¢
    // Remaining 25% rides to takeProfit (97¢) or stopLoss
  ],
};

export const STRATEGY_B = {
  name: 'strategy_b',
  label: 'Lottery',
  priceRange: [0.001, 0.08],      // 0.1¢ to 8¢
  takeProfit: 0.05,                // Exit at 5¢ (if entered below)
  stopLoss: null,                  // No stop on lottery — let them ride or expire

  // Sizing: smaller % but scales with bankroll
  sizing: {
    tiers: [
      { minEdge: 0.00, maxEdge: 0.50, pctOfBankroll: 0.02 },  // Default: 2% of bankroll
      { minEdge: 0.50, maxEdge: 0.80, pctOfBankroll: 0.03 },  // Plausible rumor: 3%
      { minEdge: 0.80, maxEdge: 1.00, pctOfBankroll: 0.05 },  // Confirmed catalyst: 5%
    ],
    absoluteMin: 0.25,    // Minimum $0.25 (even for tiny bankrolls)
    maxPctOfBankroll: 0.05, // Hard cap: 5% on lottery
  },

  // Partial sell levels for lottery
  partialSells: [
    { priceMultiple: 2.0, pctOfPosition: 0.30 },  // Sell 30% at 2x entry
    { priceMultiple: 5.0, pctOfPosition: 0.50 },  // Sell 50% at 5x entry
    // Remaining 20% rides for moonshot
  ],

  // Catalyst scoring affects sizing tier
  catalystWeights: {
    'confirmed_news': 0.90,
    'plausible_rumor': 0.60,
    'timeline_approaching': 0.40,
    'no_catalyst': 0.20,
  },
};

// ─── SIZING FUNCTIONS ───────────────────────────────────────────────────────

/**
 * Calculate bet size for a given strategy and edge
 * @param {object} strategy - STRATEGY_A or STRATEGY_B
 * @param {number} edge - estimated edge (0.0 to 1.0, e.g. 0.05 = 5%)
 * @param {number} bankroll - total bankroll in USDC
 * @returns {{ amount: number, pctUsed: number, tier: string }}
 */
export function calculateBetSize(strategy, edge, bankroll) {
  const { sizing } = strategy;

  // Find matching tier
  let pct = sizing.tiers[0].pctOfBankroll; // default to lowest
  let tierLabel = 'min';
  for (const tier of sizing.tiers) {
    if (edge >= tier.minEdge && edge < tier.maxEdge) {
      pct = tier.pctOfBankroll;
      tierLabel = `${(tier.minEdge * 100).toFixed(0)}-${(tier.maxEdge * 100).toFixed(0)}%`;
      break;
    }
  }

  // Apply hard cap
  pct = Math.min(pct, sizing.maxPctOfBankroll);

  let amount = bankroll * pct;

  // Apply absolute minimum
  amount = Math.max(amount, sizing.absoluteMin);

  // But never exceed the hard cap in dollar terms either
  amount = Math.min(amount, bankroll * sizing.maxPctOfBankroll);

  // Don't bet more than available cash
  // (caller should check this against actual cash balance)

  return {
    amount: Math.round(amount * 100) / 100, // Round to cents
    pctUsed: amount / bankroll,
    tier: tierLabel,
  };
}

/**
 * Calculate partial sell schedule for an open position
 * @param {object} strategy - STRATEGY_A or STRATEGY_B
 * @param {object} position - { side, price (entry), shares, amount }
 * @param {number} currentPrice - live market price
 * @returns {Array<{ action: string, shares: number, reason: string }>}
 */
export function getPartialSellSignals(strategy, position, currentPrice) {
  const signals = [];
  const entryPrice = position.price;

  if (strategy.name === 'strategy_a') {
    // Fixed price levels
    for (const level of strategy.partialSells) {
      const alreadySold = position.partialSells || [];
      const levelKey = `${level.price}`;
      if (alreadySold.includes(levelKey)) continue;

      if (currentPrice >= level.price) {
        const sharesToSell = Math.floor(position.shares * level.pctOfPosition * 100) / 100;
        signals.push({
          action: 'partial_sell',
          shares: sharesToSell,
          price: level.price,
          pctOfPosition: level.pctOfPosition,
          reason: `Price hit ${(level.price * 100).toFixed(0)}¢ — selling ${(level.pctOfPosition * 100)}%`,
          levelKey,
        });
      }
    }
  } else if (strategy.name === 'strategy_b') {
    // Multiple-based levels
    for (const level of strategy.partialSells) {
      const targetPrice = entryPrice * level.priceMultiple;
      const alreadySold = position.partialSells || [];
      const levelKey = `${level.priceMultiple}x`;
      if (alreadySold.includes(levelKey)) continue;

      if (currentPrice >= targetPrice) {
        const sharesToSell = Math.floor(position.shares * level.pctOfPosition * 100) / 100;
        signals.push({
          action: 'partial_sell',
          shares: sharesToSell,
          targetPrice,
          pctOfPosition: level.pctOfPosition,
          reason: `Price hit ${level.priceMultiple}x entry (${(targetPrice * 100).toFixed(1)}¢) — selling ${(level.pctOfPosition * 100)}%`,
          levelKey,
        });
      }
    }
  }

  // Check stop loss (Strategy A only)
  if (strategy.stopLoss && currentPrice <= entryPrice * (1 - strategy.stopLoss)) {
    signals.push({
      action: 'stop_loss',
      shares: position.shares, // sell all
      reason: `Stop loss triggered: ${(currentPrice * 100).toFixed(1)}¢ (entry: ${(entryPrice * 100).toFixed(1)}¢, stop: -${strategy.stopLoss * 100}%)`,
    });
  }

  // Check take profit (remaining shares)
  if (currentPrice >= strategy.takeProfit) {
    signals.push({
      action: 'take_profit',
      shares: position.shares, // sell remaining
      reason: `Take profit at ${(strategy.takeProfit * 100).toFixed(0)}¢`,
    });
  }

  // Check max hold time
  if (strategy.maxHoldHours) {
    const hoursHeld = (Date.now() - new Date(position.timestamp).getTime()) / 3600000;
    if (hoursHeld >= strategy.maxHoldHours) {
      signals.push({
        action: 'max_hold',
        shares: position.shares,
        reason: `Max hold time exceeded: ${hoursHeld.toFixed(1)}h > ${strategy.maxHoldHours}h`,
      });
    }
  }

  return signals;
}

/**
 * Get portfolio-level risk check
 * @param {object} state - full state
 * @param {string} strategyName - 'strategy_a' or 'strategy_b'
 * @returns {{ canTrade: boolean, reason: string, exposure: number }}
 */
export function checkPortfolioRisk(state, strategyName) {
  const { cash, deployed, total } = getBankroll(state);
  const bets = state.bets || [];

  // Max 50% of bankroll deployed at any time
  const maxDeployPct = 0.50;
  if (deployed / total > maxDeployPct) {
    return { canTrade: false, reason: `Already ${(deployed / total * 100).toFixed(0)}% deployed (max ${maxDeployPct * 100}%)`, exposure: deployed / total };
  }

  // Max 10 positions per strategy
  const strategyCount = bets.filter(b => b.strategy === strategyName).length;
  if (strategyCount >= 10) {
    return { canTrade: false, reason: `Already ${strategyCount} ${strategyName} positions (max 10)`, exposure: deployed / total };
  }

  // Max 30 total positions
  if (bets.length >= 30) {
    return { canTrade: false, reason: `Already ${bets.length} total positions (max 30)`, exposure: deployed / total };
  }

  return { canTrade: true, reason: 'ok', exposure: deployed / total };
}

/**
 * Summary for logging / dashboard
 */
export function sizingSummary(bankroll) {
  const aSmall = calculateBetSize(STRATEGY_A, 0.03, bankroll);
  const aMed = calculateBetSize(STRATEGY_A, 0.05, bankroll);
  const aLarge = calculateBetSize(STRATEGY_A, 0.08, bankroll);
  const bDefault = calculateBetSize(STRATEGY_B, 0.20, bankroll);
  const bCatalyst = calculateBetSize(STRATEGY_B, 0.90, bankroll);

  return {
    bankroll,
    strategyA: {
      '2-4% edge': `$${aSmall.amount} (${(aSmall.pctUsed * 100).toFixed(1)}%)`,
      '4-7% edge': `$${aMed.amount} (${(aMed.pctUsed * 100).toFixed(1)}%)`,
      '7%+ edge': `$${aLarge.amount} (${(aLarge.pctUsed * 100).toFixed(1)}%)`,
    },
    strategyB: {
      'no catalyst': `$${bDefault.amount} (${(bDefault.pctUsed * 100).toFixed(1)}%)`,
      'confirmed catalyst': `$${bCatalyst.amount} (${(bCatalyst.pctUsed * 100).toFixed(1)}%)`,
    },
  };
}
