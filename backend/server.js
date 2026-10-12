import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BlozPay} from './sdk.js';
import {merchantServer} from './merchant-api.js';
import {resolveCatalog} from './pricing.js';
const port=Number(process.env.BLOZ_PAY_MERCHANT_PORT??8083);
let provider,genesisHash,rateProvider;
if(process.env.BLOZ_PAY_SIMULATED==='1'){
 genesisHash='a'.repeat(64);
 provider={allocateAddress:async()=> 'bz1q'+randomBytes(19).toString('hex'),snapshot:async address=>{
  const state=existsSync('private/synthetic-chain.json')?JSON.parse(readFileSync('private/synthetic-chain.json')):{};
  if(state.outage)throw new Error('Synthetic chain unavailable');
  return {complete:true,genesisHash,checkedAt:Date.now(),tipHeight:100,outputs:state[address]??[]};
 }};
}else{
 if(!process.env.BLOZ_PAY_ADAPTER_MODULE)throw new Error('A verified chain adapter is required; enable simulation only for tests');
 ({provider,genesisHash,rateProvider}=await import(pathToFileURL(resolve(process.env.BLOZ_PAY_ADAPTER_MODULE))));
}
const catalog=await resolveCatalog(JSON.parse(readFileSync(process.env.BLOZ_PAY_CATALOG_FILE??new URL('./catalog.example.json',import.meta.url))),{rateProvider});
mkdirSync('private',{recursive:true,mode:0o700});
if(!/^[a-f0-9]{64}$/.test(process.env.BLOZ_PAY_RECEIPT_KEY??''))throw new Error('Independent receipt encryption key required');
const pay=new BlozPay({database:process.env.BLOZ_PAY_DB??'private/merchant.sqlite',provider,genesisHash});
const server=merchantServer({pay,port,catalog,apiKey:process.env.BLOZ_PAY_MERCHANT_KEY,receiptKey:Buffer.from(process.env.BLOZ_PAY_RECEIPT_KEY,'hex')});
server.listen(port,'127.0.0.1',()=>console.log(`BLOZ Pay on loopback ${port}; ${process.env.BLOZ_PAY_SIMULATED==='1'?'SIMULATION: NEVER SEND FUNDS':'custom chain adapter'}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await Promise.allSettled([...pay.checks.values()]);pay.close();process.exit(0)}));
