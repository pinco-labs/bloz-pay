# Choosing a chain source

All modes are server-side. The WordPress plugin uses the same local merchant API regardless of mode. Keep the merchant on loopback, credentials outside the browser, and dedicate invoice/address databases to one merchant instance. Changing a source is not permission to reset address reservations or recreate orders.

## Simulation

`BLOZ_PAY_CHAIN_MODE=simulation` (or the legacy `BLOZ_PAY_SIMULATED=1`). Synthetic addresses and file-based chain state, no RPC or wallet. Never send funds. `npm run demo:init` prepares this mode only.

## Public Electrum TLS

`BLOZ_PAY_CHAIN_MODE=electrum`, `BLOZ_PAY_ELECTRUM_TRUST=two-server-trusted-history`, `BLOZ_PAY_ADDRESSES_DB` pointing to an existing private address pool. Remove the simulation flag. Read [ELECTRUM.md](ELECTRUM.md) before selecting this mode.

The two public Electrum services are queried with verified TLS. No API key, wallet seed or private key is needed. They provide the remote chain/index view; they are not independent full-node validation on the merchant machine.

## Local node RPC plus complete index

`BLOZ_PAY_CHAIN_MODE=rpc`, `BLOZ_RPC_URL=http://127.0.0.1:18211`, private `BLOZ_RPC_USER` / `BLOZ_RPC_PASSWORD`, existing `BLOZ_PAY_ADDRESSES_DB`, and `BLOZ_PAY_CHAIN_DB` pointing to a complete, synchronized local output index.

The node must be unpruned and outside initial block download. The adapter opens the index read-only, checks genesis, requires node/index tip agreement before and after the view, retains historical received outputs even after spending and verifies a fresh complete mempool. RPC methods are read-only and allowlisted; no broadcast/sign/wallet operation is used. Configure the node account itself with read-only permissions too.

**A node RPC URL by itself is insufficient.** `listunspent` or an address balance cannot replace transaction history. The public repository includes the payment-side index reader, not a full explorer/indexer. An existing compatible index must be supplied and maintained by its operator. Required SQLite schema columns:

```text
blocks(height, hash)
transactions(txid, block_height, coinbase)
outputs(txid, n, value_rex, address)
```

The index must cover every block from the pinned genesis through the node tip, with all relevant outputs including spent outputs, correct integer rex amounts and reorg rollback. The adapter checks the tips but cannot prove an arbitrarily supplied index is complete; the operator must validate the indexer. This repository does not distribute the private explorer, its database or RPC credentials.

## Custom source / future public HTTP API

`BLOZ_PAY_CHAIN_MODE=custom` plus `BLOZ_PAY_ADAPTER_MODULE` pointing to a trusted local module exporting `provider`, `genesisHash`, and optional `rateProvider` / `closeAdapter`. A generic public HTTP address/balance API is not accepted automatically; its adapter must satisfy the same completeness and reorg requirements. The source of EUR/USD exchange rates is a separate interface from the chain source.

Run `node --env-file=PRIVATE_MERCHANT_CONFIG.env backend/server.js` from the repository root. Provide independent merchant and receipt keys, catalog, dedicated payment database and address pool in that private configuration. Do not copy demo credentials/databases into a live instance.
