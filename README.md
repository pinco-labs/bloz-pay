# BLOZ Pay WordPress — pilota privato

Versione 0.1.0 sperimentale, per un sito di prova. Non installata o verificata in un WordPress reale. Implementa articoli testuali per utenti registrati; non download protetti, webhook WordPress, carrelli, guest checkout o abbonamenti.

## Modello

Il plugin chiama il backend Node merchant sullo stesso host (`127.0.0.1`). Prezzi e conferme provengono dal catalogo Node, minimo due. Il commerciante riceve direttamente nei propri indirizzi. Nessuna chiave wallet o credenziale RPC nel plugin; nessuna custodia o percentuale Pinco Labs. Il checkout non firma trasferimenti e non esegue rimborsi.

Gli articoli riservati sono un tipo di contenuto separato, non interrogabile pubblicamente, escluso da ricerca e REST. Il corpo non è incorporato nel normale articolo pubblico: il server lo restituisce soltanto dopo authorize. Ogni nuovo accesso verifica la chain. Questo non protegge una copia già letta o salvata.

## Preparazione su staging

1. PHP 8.1+ con OpenSSL e WordPress aggiornato. Backend Node merchant configurato e in esecuzione localmente, con indirizzi nuovi dedicati; prima usare un adapter simulato o rete di prova. Non usare il negozio sintetico 8085 come backend merchant: le sue credenziali sono effimere.
2. Nel file privato `wp-config.php` definire `BLOZ_PAY_MERCHANT_URL` (esempio `http://127.0.0.1:8083`) e `BLOZ_PAY_MERCHANT_KEY` (credenziale backend). Definire anche `BLOZ_PAY_WP_RECEIPT_KEY` (32 byte casuali in hex, 64 caratteri) e `BLOZ_PAY_WP_SITE_ID` (16 byte casuali in hex, 32 caratteri). Sono valori distinti, da generare e custodire privatamente, mai nel frontend o in Git.
3. Conservare site ID e chiavi insieme ai backup privati. Cambiare site ID o ID utenti può creare nuovi ordini; perdere la chiave di cifratura impedisce di leggere ricevute salvate. Cloni staging e produzione devono avere istanze merchant e site ID distinti per evitare collisioni.
4. Installare la cartella `bloz-pay` fra i plugin del sito di prova. Nel menu **BLOZ Pay · contenuti privati** creare l'articolo; assegnare un prodotto del catalogo, per esempio `article`, e pubblicarlo oppure salvarlo privato. Un solo contenuto per prodotto; bozze escluse. La gestione è riservata agli amministratori.
5. In una pagina pubblica inserire solo teaser e shortcode `[bloz_pay product="article"]`. Il visitatore deve accedere con un account WordPress prima di creare/riprendere la richiesta.
6. Un utente ha un acquisto stabile per prodotto: requestId deriva da site ID, ID utente e prodotto. Ripetere recupera la stessa fattura e lo stesso prezzo originale. Fatture scadute non vengono sostituite automaticamente: serve riconciliazione. Per nuovi articoli usare nuovi identificativi prodotto/risorsa; non riciclare prodotti già acquistati.

## Cautele operative

- La ricevuta viene salvata AES-256-GCM nei metadati privati dell'utente, con autenticazione del contesto utente/prodotto. Token e credenziali merchant restano server-side. Il salvataggio va recuperato ripetendo lo stesso ordine in caso di interruzione.
- Autenticazione WordPress più nonce AJAX; nonce non sostituisce l'autenticazione. In produzione HTTPS del sito e backend locale non esposto al pubblico.
- Escludere le pagine shortcode e admin-ajax da cache condivise/CDN. Il plugin imposta DONOTCACHEPAGE e header non-cache quando applicabile, ma un proxy che risponde prima di PHP va configurato separatamente.
- Non caricare file riservati nella libreria media standard: gli URL degli allegati possono essere pubblici. Questo MVP protegge il testo, non immagini o download. Evitare link a materiale segreto o script nel contenuto.
- Verificare sul sito reale REST, feed, ricerca, sitemap, preview, plugin di esportazione/cache e permessi. Altri plugin possono esporre dati che questa integrazione mantiene privati.
- HTML sanitizzato con wp_kses_post; nessuna esecuzione di shortcode o filtri arbitrari nel contenuto riservato. Gli errori negano l'accesso; una reorg può revocare i nuovi accessi.
- Informativa privacy, condizioni del commerciante, fatturazione/rimborsi e verifica normativa del deployment restano responsabilità dell'integrazione. Licenza del codice distinta dai termini dei servizi; distribuzione pubblica non ancora avviata.

## Verifiche eseguite

Sintassi PHP verificata con runtime portatile ufficiale. Fixture delle API WordPress: contenuto autorizzato, pagamento assente, nonce errato, utente anonimo, ricevuta alterata e backend indisponibile; token escluso dalle risposte di creazione e corpo assente nello shortcode. Non è un collaudo di WordPress completo.

Test: impostare BLOZ_TEST_PHP e BLOZ_TEST_PHP_EXT al runtime PHP locale con OpenSSL, poi `node --test test/pay-wordpress.test.js` dalla radice del progetto. Senza runtime il test viene esplicitamente saltato.
