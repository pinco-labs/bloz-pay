// SPDX-License-Identifier: GPL-2.0-or-later
import { parseRpcJson } from './money.js';

const ALLOWED = new Set(['getblockchaininfo', 'getblockhash', 'getblock',
  'getnetworkhashps', 'getmempoolinfo', 'getrawmempool', 'getrawtransaction']);

export class Rpc {
  constructor({ url, user, password }) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error('RPC URL must be HTTP(S), without embedded credentials');
    if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
      throw new Error('HTTP RPC must use loopback or an SSH tunnel');
    if (!user || !password) throw new Error('RPC credentials are required');
    this.url = parsed;
    this.auth = Buffer.from(`${user}:${password}`).toString('base64');
  }

  async call(method, params = []) {
    if (!ALLOWED.has(method)) throw new Error('RPC method not allowed');
    const result = await this.request({ jsonrpc: '2.0', id: 'bloz-explorer', method, params });
    if (result.error) throw new Error(`RPC ${method} failed (${result.error.code})`);
    return result.result;
  }

  async batch(method, paramsList) {
    if (!ALLOWED.has(method)) throw new Error('RPC method not allowed');
    if (!paramsList.length || paramsList.length > 16) throw new Error('Invalid RPC batch size');
    const replies = await this.request(paramsList.map((params,id) => ({jsonrpc:'2.0',id,method,params})));
    if (!Array.isArray(replies) || replies.length !== paramsList.length) throw new Error('Incomplete RPC batch');
    const results = new Map();
    for (const reply of replies) {
      if (!Number.isInteger(reply.id) || reply.id<0 || reply.id>=paramsList.length || results.has(reply.id))
        throw new Error('Invalid RPC batch response');
      if (reply.error) throw new Error(`RPC ${method} failed (${reply.error.code})`);
      results.set(reply.id,reply.result);
    }
    return paramsList.map((_,id)=>results.get(id));
  }

  async request(body) {
    const response = await fetch(this.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${this.auth}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    return parseRpcJson(await response.text());
  }
}

export function rpcFromEnv() {
  return new Rpc({ url: process.env.BLOZ_RPC_URL ?? 'http://127.0.0.1:18211',
    user: process.env.BLOZ_RPC_USER, password: process.env.BLOZ_RPC_PASSWORD });
}
