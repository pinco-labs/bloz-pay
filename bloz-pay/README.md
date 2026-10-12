# BLOZ Pay

Experimental direct-wallet payments for registered-user WordPress articles. **Public prototype, not a production-ready payment gateway.** GPL-2.0-or-later.

This repository contains the WordPress plugin and a standalone Node.js merchant engine. The BLOZ explorer repository, operational configurations, wallets, address pools and private databases are not distributed. This is not a WooCommerce cart gateway and does not protect media-library files.

## What is implemented

- A separate non-public article type; content is delivered only after a fresh server-side authorization.
- Stable per-site/user/product orders and encrypted receipts; repeating a request recovers the same invoice.
- At least two confirmations in the merchant catalog; unavailable verification or reorg denies subsequent access.
- Merchant credentials and customer receipt tokens stay on the server.
- Direct BLOZ prices, or EUR/USD prices with a merchant-defined manual rate. No external exchange-rate API is used.

A merchant receives funds directly in their own wallet. The software does not receive private wallet keys, sign transfers, hold balances or charge a transaction percentage. Already delivered content cannot be revoked.

## Private simulation quick start

Requirements: Node.js 24+, PHP 8.1+ with OpenSSL, WordPress and its own database. Keep WordPress and the merchant on the same host; the plugin calls only HTTP 127.0.0.1. No npm packages are required.

```sh
npm run demo:init
npm run demo
```

Run these commands from the repository root. The first creates random credentials and a WordPress configuration snippet under `private/` (excluded from Git); the second starts the merchant on 127.0.0.1:8083 using a synthetic chain. Do not publish those generated files, and NEVER send funds to synthetic addresses.

Copy the definitions from `private/wp-config-snippet.php` into the private `wp-config.php` of your TEST installation. Install the `bloz-pay/` directory or the plugin ZIP from GitHub Releases. Backend code is in this repository, not in the plugin ZIP.

In WordPress, create one BLOZ Pay private article with product `article`, and publish it. Add only a public teaser and `[bloz_pay product="article"]` to a normal page. Log in with a test user, then create/recover the request. Initially, content is denied.

For simulation, create `private/synthetic-chain.json` with the invoice's synthetic address as a key. An example structure (replace the address placeholder) is:

```json
{
  "SYNTHETIC_INVOICE_ADDRESS": [{
    "outpoint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:0",
    "amountRex": "1000000",
    "height": 99,
    "coinbase": false
  }]
}
```

The synthetic tip is 100: height 100 gives one confirmation, 99 gives two. This amount is 0.01 BLOZ. `{}` simulates removed outputs/reorg; `{"outage":true}` simulates unavailable verification. Synthetic controls are file-based and stay outside the browser. No simulation control endpoint is exposed by the merchant.

## Merchant pricing

Direct price (decimal BLOZ string):

```json
{"article":{"amount":"0.01000000","resource":"article-example","confirmations":2,"expiresInSeconds":86400}}
```

Manual EUR price and rate (BLOZ per one EUR; USD works the same way):

```json
{"article":{"pricing":{"currency":"EUR","amount":"1.50","blozPerUnit":"2.5"},"resource":"article-example","confirmations":2,"expiresInSeconds":86400}}
```

This produces 3.75000000 BLOZ. Fiat amounts accept up to two decimal places, rates up to eight; conversion uses integer arithmetic and rounds upward to one rex. Choose `amount` OR `pricing`. Set `BLOZ_PAY_CATALOG_FILE` to your catalog file and restart the backend when changing it. Existing invoices keep their original BLOZ amount, even when the same order is recovered after catalog changes. Source fiat prices and rates are not yet stored in the invoice or displayed in the plugin checkout.

`resolveCatalog(catalog, {rateProvider})` provides an extension point for a future trusted backend rate source. No rate API is bundled. A missing or failed rate aborts catalog setup, rather than silently using a made-up rate. Rate-provider freshness, source validation and operational policy must be implemented with that integration.

## Choosing a chain source

Choose `BLOZ_PAY_CHAIN_MODE=simulation`, `electrum`, `rpc`, or `custom`. See [backend/CHAIN-MODES.md](backend/CHAIN-MODES.md) for configuration and [backend/ELECTRUM.md](backend/ELECTRUM.md) for the explicit trusted-server policy. The Electrum adapter uses two public TLS sources; local RPC requires an existing complete synchronized index. A full indexer, wallet setup and independent SPV/consensus verifier are not bundled. The adapters have synthetic and read-only historical checks; no new live WordPress payment has been verified. For custom integrations use a trusted local module exporting `provider`, `genesisHash`, and optionally `rateProvider` / `closeAdapter`.

The provider must implement:

- `allocateAddress()`: a never-used, merchant-controlled BLOZ address permanently dedicated to one invoice. The integrator must verify checksum, network, ownership and prior use; the SDK's format check is not sufficient.
- `snapshot(address)`: `{complete,genesisHash,checkedAt,tipHeight,outputs}` with a complete coherent current view including spent historical outputs and mempool. Each output has `{outpoint,amountRex,height,coinbase}`; height is null for unconfirmed outputs. Confirm block hashes/tip consistency and the pinned genesis. Never refresh timestamps on stale data.

Use dedicated database/address pools; never restore a stale address pool independently of invoice history. Keep independent random merchant and receipt encryption keys, catalog and backups private. The server binds only to loopback. A live integration requires separate operational validation; do not use real funds based only on this simulation release.

## Testing and limits

Before public release, a sanitized WordPress clone with WooCommerce/theme context passed 49 HTTP assertions on Linux hosting and Windows, using a synthetic chain: order recovery, one/two confirmations, reorg, unavailable chain, stopped backend, anonymous/nonce rejection, protected content absent from checked public HTML/REST/feed/search/sitemap routes, non-cache AJAX headers and encrypted receipts with tokens absent from captured HTTP responses. These were simulated payments, not live-chain transactions.

No shared CDN/page cache was enabled; configure and test cache exclusions before any different deployment. Media files, subscriptions, guest checkout, WooCommerce cart payments, refunds and automatic EUR/USD conversion are not implemented. Other plugins, exports and caches can expose data and require their own checks. A receipt-tampering case is covered by a PHP fixture, not the full WordPress HTTP run.

```sh
npm test
```

The PHP fixture requires `BLOZ_TEST_PHP` and `BLOZ_TEST_PHP_EXT`; without them that test is explicitly skipped. Configure these for a PHP runtime with OpenSSL. No private clone, customer data or production credentials are included in the tests.

## License

Copyright (c) 2026 Pinco Labs. GNU General Public License v2.0 or later; see LICENSE. The license applies to software, not a promise of hosted services or production support.
