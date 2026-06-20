import * as model from './widget.model.js';

function escapeJs(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/<\/script>/gi, '<\\/script>');
}

// Genera el codigo JS que el cliente embebe en su pagina
export async function generateWidgetScript(projectId) {
  const config = await model.getConfig(projectId);
  if (!config || !config.enabled) {
    return '// Widget desactivado o proyecto no existe\n';
  }
  const users = await model.listActiveWidgetUsers(projectId, config.excluded_user_ids || []);
  if (!users.length) {
    return '// No hay gestores activos en el widget\n';
  }

  const arr = users.map((u) => `["${escapeJs(u.display_name)}","${escapeJs(u.whatsapp_phone)}"]`).join(',');
  const projectName = escapeJs(config.project_nombre);
  const welcomeText = escapeJs(config.welcome_text);
  const messageTemplate = escapeJs(config.message_template);
  const bubbleDelay = Number(config.bubble_delay_ms) || 3000;
  const showBubble = !!config.show_bubble;

  // Versión BULLETPROOF v2 — añade:
  // - id genérico (c3w-w) sin "wa/whatsapp" para evitar AdBlock cosmetic filters
  // - !important en todas las posiciones críticas (resiste CSS conflictivos)
  // - append a document.documentElement (html) en vez de body (escapa containing blocks con transform/filter)
  // - Self-healing MutationObserver: si alguien lo remueve del DOM, lo re-añade
  // - Hide-others CSS solo afecta a viejos joinchat/whatsapp-flotante (no nuestro id)
  return `/*! CRM360 W ${projectName} */
!function(){var W=window,D=document,WID='c3w-w',BID='c3w-b',LID='c3w-l';if(D.getElementById(WID))return;var G=[${arr}],P='${projectName}',H='${welcomeText}',T='${messageTemplate}',B=${showBubble},Y=${bubbleDelay};if(!G.length)return;var widgetNode=null;function setS(el,cs){for(var k in cs){el.style.setProperty(k,cs[k],'important')}}function buildSvg(){return'<svg viewBox="0 0 24 24" style="width:30px;height:30px;fill:#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>'}function build(){var p=G[Math.floor(Math.random()*G.length)];var w=D.createElement('div');w.id=WID;setS(w,{position:'fixed',bottom:'20px',right:'16px','z-index':'2147483647',display:'flex','flex-direction':'column','align-items':'flex-end',gap:'8px','font-family':'system-ui,-apple-system,Segoe UI,sans-serif',visibility:'visible',opacity:'1','pointer-events':'auto',transform:'none',inset:'auto 16px 20px auto'});var m=T.replace(/\\{\\{project\\}\\}/g,P).replace(/\\{\\{url\\}\\}/g,location.href).replace(/\\{\\{nombre\\}\\}/g,p[0]);if(B){var b=D.createElement('div');b.id=BID;setS(b,{background:'#fff',color:'#333',padding:'8px 14px','border-radius':'12px','box-shadow':'0 2px 12px rgba(0,0,0,.15)','font-size':'14px','white-space':'nowrap',display:'none',visibility:'visible',opacity:'1'});b.innerHTML='<strong>'+(p[0]||'').replace(/</g,'&lt;')+'</strong>: '+H.replace(/</g,'&lt;');w.appendChild(b);setTimeout(function(){setS(b,{display:'block'})},Y);setTimeout(function(){setS(b,{display:'none'})},Y+12000)}var a=D.createElement('a');a.id=LID;a.href='https://wa.me/'+p[1]+'?text='+encodeURIComponent(m);a.target='_blank';a.rel='noopener';a.setAttribute('aria-label','Contacto');setS(a,{display:'flex','align-items':'center','justify-content':'center',width:'58px',height:'58px',background:'#25D366','border-radius':'50%','box-shadow':'0 4px 16px rgba(37,211,102,.5)','text-decoration':'none',visibility:'visible',opacity:'1','pointer-events':'auto',cursor:'pointer'});a.innerHTML=buildSvg();w.appendChild(a);return w}function mount(){if(D.getElementById(WID))return;widgetNode=build();(D.documentElement||D.body).appendChild(widgetNode)}function init(){mount();if('MutationObserver' in W){var obs=new MutationObserver(function(){if(!D.getElementById(WID)){setTimeout(mount,50)}});obs.observe(D.documentElement,{childList:true,subtree:true})}}var initOnce=function(){W.removeEventListener('scroll',initOnce);W.removeEventListener('touchstart',initOnce);W.removeEventListener('click',initOnce);init()};W.addEventListener('scroll',initOnce,{passive:true,once:true});W.addEventListener('touchstart',initOnce,{passive:true,once:true});W.addEventListener('click',initOnce,{passive:true,once:true});if(D.readyState==='loading'){D.addEventListener('DOMContentLoaded',function(){setTimeout(initOnce,300)})}else{setTimeout(initOnce,300)}}();
`;
}
