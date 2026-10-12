// Import only in the merchant backend. Never bundle its API key into frontend code.
export class BlozPayMerchantClient {
 constructor({url='http://127.0.0.1:8083',apiKey}) {
  this.url=new URL(url);
  if(this.url.protocol!=='http:'||this.url.hostname!=='127.0.0.1'||this.url.username||this.url.password||this.url.pathname!=='/'||this.url.search||this.url.hash||!/^[-_A-Za-z0-9]{32,200}$/.test(apiKey??''))throw new Error('Loopback merchant endpoint and valid API key required');
  this.apiKey=apiKey;
 }
 async request(path,body) {
  // Creation is deliberately not retried: an ambiguous timeout may have created an invoice.
  const response=await fetch(new URL(path,this.url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.apiKey},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error??'Merchant request failed');
  return result;
 }
 createInvoice(product,requestId){return this.request('/v1/invoices',{product,requestId});}
 status(id){return this.request('/v1/status',{id});}
 async authorize({id,accessToken,product}){return (await this.request('/v1/authorize',{id,accessToken,product})).authorized===true;}
}
