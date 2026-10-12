/**
 * El código que cada web pega para el botón de WhatsApp (snippet INLINE: el botón es HTML
 * puro, aparece siempre aunque WP Rocket/LiteSpeed retrasen los scripts; un mini-script pide
 * al CRM las gestoras y los textos).
 *
 * Idiomas (Diego, 12/10: «versiones idiomáticas: inglés, francés y así»): con `idioma`
 * vacío, el código mira el idioma de la página (`<html lang>`, y si no hay, el del
 * navegador); con «en», «fr»… lo fija (webs de un solo idioma, como ictess.us). Si el
 * idioma no es uno de los del CRM, sale el español. La burbuja respeta «mostrar burbuja» y
 * «aparece a los (ms)» del panel.
 */
export const IDIOMAS_WIDGET = [
  { codigo: 'es', nombre: 'Español' },
  { codigo: 'en', nombre: 'English' },
  { codigo: 'fr', nombre: 'Français' },
  { codigo: 'pt', nombre: 'Português' },
] as const;
export type IdiomaWidget = typeof IDIOMAS_WIDGET[number]['codigo'];

const SVG = '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

export function construirSnippet({ dataUrl, idioma = '' }: { dataUrl: string; idioma?: IdiomaWidget | '' }): string {
  const fijo = idioma ? `'${idioma}'` : "''";
  return `<!-- WhatsApp CRM360${idioma ? ` · ${idioma}` : ''} -->
<style>
#c3w{position:fixed!important;bottom:20px!important;right:16px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;align-items:flex-end!important;gap:8px!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
#c3w-tag{display:none!important;background:#fff!important;color:#111!important;border-radius:14px!important;padding:8px 14px!important;box-shadow:0 3px 14px rgba(0,0,0,.15)!important;font-size:14px!important;white-space:nowrap!important;cursor:pointer!important;line-height:1.4!important}
#c3w-tag.s{display:block!important}
#c3w-tag b{color:#25D366!important;font-weight:700!important}
#c3w-btn{width:58px!important;height:58px!important;background:#25D366!important;border:none!important;border-radius:50%!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;box-shadow:0 4px 16px rgba(37,211,102,.5)!important;padding:0!important;margin:0!important;transition:transform .2s!important}
#c3w-btn:hover{transform:scale(1.08)!important}
#c3w-btn svg{width:30px!important;height:30px!important;fill:#fff!important;display:block!important}
</style>
<div id="c3w" role="complementary">
  <div id="c3w-tag"><b id="c3w-name"></b> <span id="c3w-msg"></span></div>
  <button id="c3w-btn" aria-label="WhatsApp" type="button">
    ${SVG}
  </button>
</div>
<script>
(function(){if(window.__c3w)return;window.__c3w=1;
var F=${fijo},L=(F||document.documentElement.lang||navigator.language||'es').slice(0,2).toLowerCase();
var wa=null,btn=document.getElementById('c3w-btn'),tag=document.getElementById('c3w-tag'),nm=document.getElementById('c3w-name'),mg=document.getElementById('c3w-msg');
function go(){if(wa)window.open(wa,'_blank')}
btn.addEventListener('click',go);tag.addEventListener('click',go);
fetch('${dataUrl}').then(function(r){return r.json()}).then(function(d){
  if(!d.enabled||!d.gestoras||!d.gestoras.length){document.getElementById('c3w').style.display='none';return}
  var t=(d.textos&&(d.textos[L]||d.textos.es))||{};
  var p=d.gestoras[Math.floor(Math.random()*d.gestoras.length)];
  var msg=(t.template||d.template||'Hola, quiero información: {{url}}').replace(/\{\{nombre\}\}/g,p[0]).replace(/\{\{project\}\}/g,d.project||'').replace(/\{\{url\}\}/g,location.href);
  wa='https://wa.me/'+p[1]+'?text='+encodeURIComponent(msg);
  nm.textContent=p[0];mg.textContent=t.welcome||d.welcome||'¿Hablamos? 👋';
  if(d.burbuja===false)return;
  var y=d.retraso>=0?d.retraso:3000;
  setTimeout(function(){tag.className='s'},y);
  setTimeout(function(){tag.className=''},y+12000);
}).catch(function(){document.getElementById('c3w').style.display='none'});
})();
</script>`;
}
