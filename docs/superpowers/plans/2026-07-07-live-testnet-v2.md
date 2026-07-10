# Phase 2: Live testnet verification of SDK v2 (self-hosted Lazer) + indexer v2

User directive (2026-07-07): no Pyth Lazer subscription is available. Deploy the
official pyth-lazer-stellar contract ourselves (pinned commit
9ceafd71b64a86dabb4fd8377f8f831a10ae3d5b of pyth-network/pyth-lazer-public), set
our own trusted signer key, and sign price updates ourselves. Then deploy zenex
v2 via zenex-utils with a config of our choosing (user explicitly waived the
deploy.json confirmation gate for this test deployment), live-test the SDK
actions against testnet, and bring zenex-indexer to a v2 branch on the new SDK.

## Global Constraints

- Secrets live in /home/robin/Zenith/Zenex/.dev-env.toml only. Never commit or
  print secret keys. New secrets (Lazer signer) are recorded there.
- Stellar testnet, RPC https://soroban-testnet.stellar.org, admin identity
  zenex-admin-v4 (secret in .dev-env.toml [admin]).
- The price-verifier delegates envelope verification to the Lazer contract via
  `verify_update(Bytes) -> Bytes`. Inner payload format is the vendored parser
  at zenex-contracts/price-verifier/src/payload.rs (magic 2479346549). Required
  per-feed properties for the verifier: price, bestBidPrice, bestAskPrice,
  exponent, confidence, feedUpdateTimestamp (micros). price/bid/ask > 0,
  bid <= ask, confidence within maxConfidenceBps, publish time within
  max_staleness (max 15s) of ledger time.
- All live contract interactions in the smoke test go through SDK-built XDR
  (that is the point of the test).
- No em-dash in prose. Conventional commits. No pushes (CodeRabbit gate first).

## Tasks

- Task 11: self-host pyth-lazer-stellar on testnet + TypeScript payload signer
  in zenex-utils (brief: .superpowers/sdd/task-11-brief.md)
- Task 12: choose final testnet config, deploy zenex v2 via zenex-utils
  (brief: task-12-brief.md; depends on 11)
- Task 13: rework v2-smoke.ts to self-signed prices, run full SDK action matrix
  live (brief: task-13-brief.md; depends on 12)
- Task 14: zenex-indexer v2 branch on SDK 3.0.0 (brief: task-14-brief.md;
  independent, runs in parallel)
