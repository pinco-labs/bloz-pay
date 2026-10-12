import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {toRex} from './money.js';

// Server-to-server API. The merchant keeps this credential out of customer browsers.
export function merchantServer({pay,apiKey,receiptKey,catalog,port=8083}) {
 if(typeof apiKey!=='string'||!/^[-_A-Za-z0-9]{32,200}$/.test(apiKey)||!pay||!Number.isInteger(port)||port<0||port>65535)throw new Error('Merchant key, payment service and valid port required');
 if(!Buffer.isBuffer(receiptKey)||receiptKey.length!==32)throw new Error('Independent receipt encryption key required');
 const products=new Map();
 for(const [id,item] of Object.entries(catalog??{})) {
  if(!/^[a-z0-9-]{1,64}$/.test(id)||typeof item.amount!=='string'||toRex(item.amount)<=0n||toRex(item.amount)>9223372036854775807n||typeof item.resource!=='string'||!item.resource||item.resource.length>100||!Number.isInteger(item.confirmations)||item.confirmations<2||item.confirmations>1000||!Number.isInteger(item.expiresInSeconds)||item.expiresInSeconds<60||item.expiresInSeconds>86400)throw new Error('Invalid merchant catalog');
  products.set(id,Object.freeze({...item}));
 }
 if(!products.size)throw new Error('Merchant catalog required');
 const expected=createHash('sha256').update(apiKey).digest();
 let creating=false,requests=0,windowStart=Date.now();
 const reply=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 return createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  const actualPort=res.socket.localPort;
  if(req.headers.host!==`127.0.0.1:${actualPort}`)return reply(res,400,{error:'Invalid host'});
  // Browser integrations must call their own merchant backend, never this endpoint.
  if(req.headers.origin)return reply(res,403,{error:'Server-to-server requests only'});
  const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if(!token||!timingSafeEqual(expected,createHash('sha256').update(token).digest()))return reply(res,401,{error:'Unauthorized'});
  if(Date.now()-windowStart>=60000){requests=0;windowStart=Date.now();}
  if(++requests>120)return reply(res,429,{error:'Rate limit exceeded'});
  if(req.method!=='POST'||req.headers['content-type']!=='application/json')return reply(res,405,{error:'JSON POST required'});
  try {
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return reply(res,413,{error:'Request too large'});}
   let body;try{body=JSON.parse(raw);}catch{return reply(res,400,{error:'Invalid JSON'});}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply(res,400,{error:'Invalid request'});
   if(req.url==='/v1/invoices') {
    if(Object.keys(body).some(key=>!['product','requestId'].includes(key))||!products.has(body.product)||!/^[A-Za-z0-9_-]{16,100}$/.test(body.requestId??''))return reply(res,400,{error:'Known product required; prices are server-controlled'});
    if(creating)return reply(res,409,{error:'Invoice creation in progress; inspect existing request before retrying'});
    creating=true;
    try{return reply(res,201,await pay.createIdempotentInvoice({requestId:body.requestId,product:body.product,options:products.get(body.product),key:receiptKey}));}finally{creating=false;}
   }
   if(!/^[a-f0-9]{48}$/.test(body.id??''))return reply(res,400,{error:'Valid invoice ID required'});
   if(req.url==='/v1/status') {
    try{pay.invoice(body.id);}catch{return reply(res,404,{error:'Invoice not found'});}
    return reply(res,200,await pay.check(body.id));
   }
   if(req.url==='/v1/authorize') {
    const item=products.get(body.product);
    if(!item||typeof body.accessToken!=='string')return reply(res,400,{error:'Product and customer receipt required'});
    return reply(res,200,{authorized:await pay.authorize(body.id,body.accessToken,item.resource)});
   }
   return reply(res,404,{error:'Not found'});
  }catch(error){return reply(res,error.code==='CONFLICT'?409:503,{error:error.code==='CONFLICT'?error.message:'Payment service unavailable; retain the same request ID'});}
 });
}
