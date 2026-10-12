import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BlozPay} from './sdk.js';
import {merchantServer} from './merchant-api.js';
import {resolveCatalog} from './pricing.js';
const port=Number(process.env.BLOZ_PAY_MERCHANT_PORT??8083);
const mode=process.env.BLOZ_PAY_CHAIN_MODE??(process.env.BLOZ_PAY_SIMULATED==='1'?'simulation':process.env.BLOZ_PAY_ADAPTER_MODULE?'custom':null);
if(!['simulation','electrum','rpc','custom'].includes(mode))throw new Error('Choose BLOZ_PAY_CHAIN_MODE: simulation, electrum, rpc or custom');
if(mode!=='simulation'&&process.env.BLOZ_PAY_SIMULATED==='1')throw new Error('Remove simulation flag before selecting a real-chain adapter');
let provider,genesisHash,rateProvider,closeAdapter;
if(mode==='simulation'){
 genesisHash='a'.repeat(64);
 provider={allocateAddress:async()=> 'bz1q'+randomBytes(19).toString('hex'),snapshot:async address=>{
  const state=existsSync('private/synthetic-chain.json')?JSON.parse(readFileSync('private/synthetic-chain.json')):{};
  if(state.outage)throw new Error('Synthetic chain unavailable');
  return {complete:true,genesisHash,checkedAt:Date.now(),tipHeight:100,outputs:state[address]??[]};
 }};
}else{
 const module=mode==='electrum'?new URL('./electrum-adapter.js',import.meta.url):mode==='rpc'?new URL('./rpc-adapter.js',import.meta.url):process.env.BLOZ_PAY_ADAPTER_MODULE?pathToFileURL(resolve(process.env.BLOZ_PAY_ADAPTER_MODULE)):null;
 if(!module)throw new Error('Custom chain adapter module required');
 ({provider,genesisHash,rateProvider,closeAdapter}=await import(module));
}
const catalog=await resolveCatalog(JSON.parse(readFileSync(process.env.BLOZ_PAY_CATALOG_FILE??new URL('./catalog.example.json',import.meta.url))),{rateProvider});
mkdirSync('private',{recursive:true,mode:0o700});
if(!/^[a-f0-9]{64}$/.test(process.env.BLOZ_PAY_RECEIPT_KEY??''))throw new Error('Independent receipt encryption key required');
const pay=new BlozPay({database:process.env.BLOZ_PAY_DB??'private/merchant.sqlite',provider,genesisHash});
const server=merchantServer({pay,port,catalog,apiKey:process.env.BLOZ_PAY_MERCHANT_KEY,receiptKey:Buffer.from(process.env.BLOZ_PAY_RECEIPT_KEY,'hex')});
server.listen(port,'127.0.0.1',()=>console.log(`BLOZ Pay on loopback ${port}; ${mode==='simulation'?'SIMULATION: NEVER SEND FUNDS':mode+' chain adapter'}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await Promise.allSettled([...pay.checks.values()]);pay.close();closeAdapter?.();process.exit(0)}));
