import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCatalog} from '../backend/pricing.js';
test('merchant chooses direct BLOZ or exact manual EUR/USD rate, with future backend provider',async()=>{
 const options={resource:'article',confirmations:2,expiresInSeconds:86400};
 const catalog=await resolveCatalog({direct:{...options,amount:'0.01'},eur:{...options,pricing:{currency:'EUR',amount:'1.50',blozPerUnit:'2.5'}},usd:{...options,pricing:{currency:'USD',amount:'0.01',blozPerUnit:'0.00000001'}}});
 assert.equal(catalog.direct.amount,'0.01');assert.equal(catalog.eur.amount,'3.75000000');assert.equal(catalog.usd.amount,'0.00000001');
 const dynamic={article:{...options,pricing:{currency:'EUR',amount:'2.00'}}};
 await assert.rejects(resolveCatalog(dynamic));
 const resolved=await resolveCatalog(dynamic,{rateProvider:async({currency,product})=>{assert.equal(currency,'EUR');assert.equal(product,'article');return '1.25'}});
 assert.equal(resolved.article.amount,'2.50000000');
 await assert.rejects(resolveCatalog({x:{...options,amount:'1',pricing:{currency:'USD',amount:'1',blozPerUnit:'1'}}}));
 await assert.rejects(resolveCatalog({x:{...options,pricing:{currency:'USD',amount:'0',blozPerUnit:'1'}}}));
 await assert.rejects(resolveCatalog(dynamic,{rateProvider:async()=>{throw new Error('Unavailable rate')}}));
});
