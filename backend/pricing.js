// SPDX-License-Identifier: GPL-2.0-or-later
// Prices and exchange rates are merchant-controlled, never browser-controlled.
import {toRex,formatBloz} from './money.js';
export async function resolveCatalog(catalog,{rateProvider}={}) {
 const result={};
 for(const [product,item] of Object.entries(catalog)){
  if(!item.pricing){result[product]={...item};continue;}
  if(item.amount!==undefined)throw new Error('Choose direct BLOZ or fiat pricing, not both');
  const {currency,amount,blozPerUnit}=item.pricing;
  if(!['EUR','USD'].includes(currency)||typeof amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(amount))throw new Error('Fiat price requires EUR/USD and a decimal string with at most two places');
  const rate=blozPerUnit??await rateProvider?.({currency,product});
  if(typeof rate!=='string'||toRex(rate)<=0n)throw new Error('Positive merchant rate or backend rate provider required');
  const [whole,fraction='']=amount.split('.');const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  const rex=(cents*toRex(rate)+99n)/100n; // Round up to one rex; no floating point.
  if(rex<=0n||rex>9223372036854775807n)throw new Error('Converted price out of range');
  const {pricing,...options}=item;result[product]={...options,amount:formatBloz(rex)};
 }
 return result;
}
