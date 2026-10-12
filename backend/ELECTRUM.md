# Experimental Electrum adapter

Default TLS servers: `electrum-bloz.pinco-labs.com:50002` and `electrum2-bloz.pinco-labs.com:50002`. Certificates and host names are verified. Only read methods are allowed; no transaction can be broadcast by this client.

The provider pins BLOZ mainnet genesis `44c1a8c852b3eda21966e1ddb6b0807e22488dffe8a270bf24bf1fa2d66c13bd`, verifies its raw header, compares both servers, reads full address transaction history including spent receipts, parses raw transactions/SegWit txids and integer outputs, checks payment Merkle proofs, then rechecks tip/history/payment headers. Coinbase does not pay invoices. Divergent, malformed, unstable, unavailable or stale views deny access. Default limit: 1000 history transactions, 20-second snapshot deadline and a tip no older than 24 hours. Excessive history fails closed rather than truncating. Only native `bz1` SegWit v0 20-byte keyhash addresses are supported.

## Explicit trust boundary

**This is not a full consensus/SPV verifier.** It does not validate proof of work, difficulty, a complete header chain to genesis, transaction validity or prove the absence of omitted transactions. `complete:true` means a complete view under the configured trusted-server policy. Merkle proofs validate inclusion relative to the server-provided payment header; they do not independently prove that header is on the strongest valid chain.

The two default servers share an operator. Agreement catches outages, corruption, lag and ordinary disagreement, but not a shared dishonest or compromised source. TLS authenticates the service, not the truth of its chain view. Querying both also reveals the watched public address/script hash to both services. Prefer the local validated-node/index mode when that trust boundary is unacceptable.

Real-chain mode requires explicit `BLOZ_PAY_ELECTRUM_TRUST=two-server-trusted-history`, so simulation does not silently become a live deployment. Validation includes synthetic tests, historical read-only probes and one voluntary 1 BLOZ WordPress payment on 12 October 2026, delivered after two confirmations. This is not a production audit; real reorgs were not induced.

## Address pool

Generate never-used native SegWit receive addresses in a merchant-owned wallet and verify its backup yourself. Export **only public addresses** as a private JSON array; never provide seed/private keys. The tool can verify syntax and observed absence of history, not key ownership, previous fork usage or wallet backup.

```sh
node backend/import-electrum-addresses.js private/unused-public-addresses.json private/electrum-addresses.sqlite --merchant-owns-and-backed-up
```

Import checks both histories before saving. Reservation is atomic/persistent; re-importing does not reset it. Allocation reserves first and checks again; failures burn a reservation instead of reusing an address. Back up wallet, invoice database and address pool coherently, and never share addresses among independent pools. Offline or omitted history must never be treated as confirmation of safe reuse outside this declared trust policy.

Read-only watch probe (no invoice/address reservation):

```sh
node backend/probe-electrum.js PUBLIC_BLOZ_ADDRESS
```

Select the adapter as described in [CHAIN-MODES.md](CHAIN-MODES.md). Keep the existing WordPress clone simulated until merchant ownership/backup, dedicated live configuration, and the intended small voluntary payment are separately verified.
