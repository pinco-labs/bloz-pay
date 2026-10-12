document.querySelectorAll('.bloz-pay').forEach(section=>{
 let busy=false;const status=section.querySelector('.bloz-pay-status'),details=section.querySelector('.bloz-pay-details'),content=section.querySelector('.bloz-pay-content');
 section.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',async()=>{
  if(busy)return;busy=true;status.textContent='Verifica in corso…';content.replaceChildren();
  try{
   const command=button.dataset.command,body=new URLSearchParams({action:'bloz_pay_'+command,product:section.dataset.product,nonce:section.dataset.nonce});
   const response=await fetch(section.dataset.url,{method:'POST',credentials:'same-origin',body});const result=await response.json();
   if(!response.ok||!result.success)throw new Error(result.data?.message??'Operazione indisponibile');
   const data=result.data;
   if(command==='content'){
    // HTML is sanitized by WordPress on the authenticated content endpoint.
    content.innerHTML=data.content;status.textContent='Contenuto autorizzato dal server.';
   }else{
    const rows=[['Fattura',data.id],['Indirizzo BLOZ',data.address],['Importo BLOZ',data.amount],['Conferme richieste',data.confirmations],['Scadenza',new Date(data.expiresAt).toLocaleString()]];
    if(command==='status')rows.splice(4,0,['Conferme raggiunte',Number.isInteger(data.paymentConfirmations)?data.paymentConfirmations:(data.status==='unavailable'?'Verifica indisponibile':'Importo completo non ancora rilevato')]);
    details.replaceChildren();for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);details.append(dt,dd);}
    const messages={awaiting:'Pagamento non ancora rilevato.',confirming:'Pagamento rilevato: in attesa delle conferme richieste. Non inviare un altro pagamento.',paid:'Pagamento confermato. Puoi aprire il contenuto; non pagare di nuovo.',partial:'Importo ricevuto parziale. Contatta il commerciante prima di inviare altro.',expired:'Richiesta scaduta. Contatta il commerciante; non pagare di nuovo.',unavailable:'Verifica temporaneamente indisponibile. Riprova la stessa richiesta: non inviare un altro pagamento.'};
    status.textContent=command==='order'?'Richiesta recuperata o creata. Se hai già pagato, verifica il pagamento senza inviare altri fondi.':(messages[data.status]??'Stato pagamento non disponibile. Riprova la stessa richiesta senza inviare altri fondi.');
   }
  }catch(error){status.textContent=error.message;}finally{busy=false;}
 }));
});
