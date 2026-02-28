#!/bin/bash
# Polymarket scanner cron — runs every 5 minutes
export POLYMARKET_PROXY_URL=https://polymarket-proxy-arn.fly.dev
export POLYMARKET_PRIVATE_KEY=$POLYMARKET_PRIVATE_KEY
export PATH="/usr/local/bin:/usr/bin:/bin"

cd /data/workspace/polymarket-arb
node lib/scanner-cron.mjs 2>&1 >> logs/scanner.log