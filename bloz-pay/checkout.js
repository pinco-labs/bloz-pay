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
    details.replaceChildren();for(const [label,value] of [['Fattura',data.id],['Indirizzo BLOZ',data.address],['Importo BLOZ',data.amount],['Conferme richieste',data.confirmations],['Scadenza',new Date(data.expiresAt).toLocaleString()]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);details.append(dt,dd);}
    status.textContent=command==='order'?'Richiesta pronta. Controlla importo e indirizzo prima di pagare.':'Stato pagamento: '+data.status;
   }
  }catch(error){status.textContent=error.message;}finally{busy=false;}
 }));
});
