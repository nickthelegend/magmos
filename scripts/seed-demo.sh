#!/usr/bin/env bash
# Magmos demo seeder — creates the Track-1 demo in one command:
#   "Falcon Marketplace FZ-LLC" (UAE) streaming USDC to creators in Manila, Lagos, Karachi.
# - names → Mongo via the org app's /api (EIP-191 signed with the deployer key)
# - streams → on-chain via MagmosPayroll.deposit (approve + deposit)
# - recipient keys saved to scripts/.demo-wallets.json (GITIGNORED) so you can import one
#   into MetaMask and demo the recipient portal / claim.
# Requirements: org app running on http://localhost:3000, foundry (cast), jq.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/contracts/.env.deployer"
DEPLOYMENTS="$ROOT/contracts/deployments/arc-testnet.json"
RPC="https://rpc.testnet.arc.network"
# Addresses come from the deployment record so a redeploy never leaves this script stale.
PAYROLL=$(jq -r .MagmosPayroll "$DEPLOYMENTS")
ADVANCE=$(jq -r .MagmosAdvance "$DEPLOYMENTS")
TUSDC=$(jq -r .MagmosUSDC "$DEPLOYMENTS")
API="${MAGMOS_API:-http://localhost:3100}"   # org app (see RUN.md — Magmos runs on 3100/3001)
SKIP_CHAIN="${SKIP_CHAIN:-0}"                # SKIP_CHAIN=1 → only (re)write org+names via the API
SKIP_API="${SKIP_API:-0}"                    # SKIP_API=1   → chain only (names already in Mongo)
SEED_ADVANCE="${SEED_ADVANCE:-1}"            # SEED_ADVANCE=0 → skip the earned-wage-access seeding
ACCRUE_SECS="${ACCRUE_SECS:-120}"            # let the stream accrue before drawing a demo advance
MONTH_S=2592000

echo "→ payroll  $PAYROLL"
echo "→ advance  $ADVANCE"

# sanity: make sure the API is actually the Magmos org app, not another project on the port
if [ "$SKIP_API" != "1" ]; then
  if ! curl -sf "$API/api/orgs/0x0000000000000000000000000000000000000001" -o /dev/null -w "" 2>/dev/null; then
    # 404-with-JSON is fine (route exists); connection refused / HTML 404 page is not.
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/orgs/0x0000000000000000000000000000000000000001" || echo "000")
    if [ "$CODE" != "404" ] && [ "$CODE" != "200" ]; then
      echo "✗ $API does not look like the Magmos org app (HTTP $CODE). Start it: cd app && PORT=3100 bun dev"; exit 1
    fi
  fi
fi

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
export $(grep -v '^#' "$ENV_FILE" | xargs)
ORG="$DEPLOYER_ADDRESS"; PK="$DEPLOYER_PRIVATE_KEY"

# ---- demo recipients (name, city, monthly USDC) ----
NAMES=("Maya Santos — Manila" "Amara Diallo — Lagos" "Hassan Raza — Karachi")
SALARIES=(2400 3200 1600)     # human USDC / month
TOTAL_RAW=7200000000          # sum * 1e6

WALLETS_FILE="$ROOT/scripts/.demo-wallets.json"
if [ ! -f "$WALLETS_FILE" ]; then
  echo "→ generating 3 demo recipient wallets"
  TMP="[]"
  for i in 0 1 2; do
    OUT=$(cast wallet new)
    ADDR=$(echo "$OUT" | grep -i '^Address' | awk '{print $NF}')
    KEY=$(echo "$OUT" | grep -i 'Private key' | awk '{print $NF}')
    TMP=$(echo "$TMP" | jq --arg n "${NAMES[$i]}" --arg a "$ADDR" --arg k "$KEY" --argjson s "${SALARIES[$i]}" \
      '. + [{name:$n, address:$a, privateKey:$k, monthlyUsdc:$s}]')
  done
  echo "$TMP" > "$WALLETS_FILE"; chmod 600 "$WALLETS_FILE"
fi
ADDRS=($(jq -r '.[].address' "$WALLETS_FILE"))
echo "→ recipients: ${ADDRS[*]}"

# ---- EIP-191 auth headers (magmos-auth:<lowercased addr>:<unixMs>) ----
if [ "$SKIP_API" != "1" ]; then
  NOW_MS=$(($(date +%s) * 1000))
  ORG_LC=$(echo "$ORG" | tr '[:upper:]' '[:lower:]')
  MSG="magmos-auth:${ORG_LC}:${NOW_MS}"
  SIG=$(cast wallet sign --private-key "$PK" "$MSG")
  AUTH=(-H "x-magmos-address: $ORG" -H "x-magmos-message: $MSG" -H "x-magmos-signature: $SIG" -H "content-type: application/json")

  echo "→ upserting org profile"
  curl -sf -X POST "$API/api/orgs/$ORG" "${AUTH[@]}" \
    -d '{"name":"Falcon Marketplace FZ-LLC"}' >/dev/null || { echo "✗ org upsert FAILED"; exit 1; }
  echo "  org ok"

  echo "→ saving recipient names"
  BULK=$(jq -c '{employees: [.[] | {walletAddress: .address, name: .name, monthlyUsdc: .monthlyUsdc}]}' "$WALLETS_FILE")
  curl -sf -X POST "$API/api/orgs/$ORG/employees/bulk" "${AUTH[@]}" -d "$BULK" | jq -c . \
    || { echo "✗ bulk names FAILED"; exit 1; }
else
  echo "→ SKIP_API=1 — leaving org/recipient names in Mongo untouched"
fi

if [ "$SKIP_CHAIN" = "1" ]; then
  echo "✅ names-only seed done (SKIP_CHAIN=1) — streams unchanged."
  exit 0
fi

# ---- on-chain: ensure balance, approve, deposit + start 3 streams ----
BAL=$(cast call "$TUSDC" "balanceOf(address)(uint256)" "$ORG" --rpc-url "$RPC" | awk '{print $1}')
if [ "$BAL" -lt "$TOTAL_RAW" ]; then
  echo "→ balance low ($BAL) — minting 10,000 from faucet"
  cast send "$TUSDC" "faucet()" --rpc-url "$RPC" --private-key "$PK" >/dev/null
fi

echo "→ approving $((TOTAL_RAW / 1000000)) USDC"
cast send "$TUSDC" "approve(address,uint256)" "$PAYROLL" "$TOTAL_RAW" --rpc-url "$RPC" --private-key "$PK" >/dev/null

POOLID=$(cast call "$PAYROLL" "poolIdFor(address,address)(bytes32)" "$ORG" "$TUSDC" --rpc-url "$RPC")
EXISTS=$(cast call "$PAYROLL" "getPool(bytes32)(address,address,uint256,uint256,uint256,bool)" "$POOLID" --rpc-url "$RPC" | tail -1)
EMP_ARR="[${ADDRS[0]},${ADDRS[1]},${ADDRS[2]}]"
RATE_ARR="[2400000000,3200000000,1600000000]"
PERIOD_ARR="[$MONTH_S,$MONTH_S,$MONTH_S]"

echo "→ funding + starting 3 streams (pool exists: $EXISTS)"
if [ "$EXISTS" = "true" ]; then
  TX=$(cast send "$PAYROLL" "deposit(bytes32,uint256,address[],uint256[],uint256[])" \
    "$POOLID" "$TOTAL_RAW" "$EMP_ARR" "$RATE_ARR" "$PERIOD_ARR" \
    --rpc-url "$RPC" --private-key "$PK" --json | jq -r .transactionHash)
else
  TX=$(cast send "$PAYROLL" "createPoolAndDeposit(address,uint256,address[],uint256[],uint256[])" \
    "$TUSDC" "$TOTAL_RAW" "$EMP_ARR" "$RATE_ARR" "$PERIOD_ARR" \
    --rpc-url "$RPC" --private-key "$PK" --json | jq -r .transactionHash)
fi
echo "  tx: https://testnet.arcscan.app/tx/$TX"

# ---- Earned Wage Access: subsidy pool + one real draw --------------------------
# Shows the dashboard in a realistic state: float yield parked to cover access fees, and a
# worker who has already drawn part of what they earned (netted against their next claim).
if [ "$SEED_ADVANCE" = "1" ]; then
  echo ""
  echo "→ [EWA] funding the yield subsidy pool (covers workers' access fees)"
  SUBSIDY_RAW=50000000   # 50 USDC of "float yield" set aside
  cast send "$TUSDC" "approve(address,uint256)" "$ADVANCE" "$SUBSIDY_RAW" \
    --rpc-url "$RPC" --private-key "$PK" >/dev/null
  cast send "$ADVANCE" "fundSubsidy(address,uint256)" "$TUSDC" "$SUBSIDY_RAW" \
    --rpc-url "$RPC" --private-key "$PK" >/dev/null
  echo "  subsidy pool: $((SUBSIDY_RAW / 1000000)) USDC"

  # The worker signs their own draw, so they need a little native USDC for gas.
  WORKER=$(jq -r '.[0].address' "$WALLETS_FILE")
  WORKER_PK=$(jq -r '.[0].privateKey' "$WALLETS_FILE")
  GAS_BAL=$(cast balance "$WORKER" --rpc-url "$RPC")
  if [ "$(echo "$GAS_BAL" | cut -c1-1)" = "0" ] && [ "${#GAS_BAL}" -lt 17 ]; then
    echo "→ [EWA] funding worker gas (0.3 native USDC)"
    cast send "$WORKER" --value 300000000000000000 --rpc-url "$RPC" --private-key "$PK" >/dev/null
  fi

  echo "→ [EWA] letting the stream accrue for ${ACCRUE_SECS}s before the demo draw…"
  sleep "$ACCRUE_SECS"

  DRAWABLE=$(cast call "$ADVANCE" "drawableAmount(bytes32,address)(uint256)" "$POOLID" "$WORKER" \
    --rpc-url "$RPC" | awk '{print $1}')
  echo "  drawable now: $DRAWABLE raw"
  if [ "$DRAWABLE" -ge 10000 ]; then
    # Draw half of what has been earned — leaves a visible remainder on the claim.
    DRAW=$((DRAWABLE / 2))
    [ "$DRAW" -lt 10000 ] && DRAW=$DRAWABLE
    ATX=$(cast send "$ADVANCE" "drawAdvance(bytes32,uint256)" "$POOLID" "$DRAW" \
      --rpc-url "$RPC" --private-key "$WORKER_PK" --json | jq -r .transactionHash)
    echo "  ✓ advance drawn: $DRAW raw  →  https://testnet.arcscan.app/tx/$ATX"
  else
    echo "  (nothing accrued yet — raise ACCRUE_SECS and re-run to seed a draw)"
  fi
fi

echo ""
echo "✅ Demo seeded — open http://localhost:3100/dashboard (org) to watch 3 live streams."
echo "   Recipient demo: import a key from scripts/.demo-wallets.json into MetaMask,"
echo "   then open http://localhost:3001 to see the live ticker, draw, and claim."