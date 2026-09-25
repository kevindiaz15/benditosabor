/* =============================================================== */
/* BENDITO SABOR · Panel administrador (Supabase Auth + RLS)       */
/* Gestión de productos y pedidos recibidos desde la tienda.       */
/* =============================================================== */

let sb = null;
let admCuentas = [];
let editandoId = null;
let fotoPendiente = null;   /* File a subir (o null) */
let quitarFoto = false;

let pedidos = [];           /* Pedidos recibidos desde la tienda */
let solFiltro = '';
let solBusqueda = '';

let ventaBusqueda = '';
let ventaFiltroEstado = '';
let ventaFiltroMetodo = '';

let banners = [];           /* Banners publicitarios */
let editandoBannerId = null;
let bannerFotoPendiente = null;
let quitarBannerFoto = false;

const CATS = [
  ['tortas','Tortas'],['postres','Postres'],['cupcakes','Cupcakes'],
  ['panaderia','Panadería'],['dulces','Dulces']
];

const $ = id => document.getElementById(id);

function uid(){
  try{ if(crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  return 'f' + Date.now() + Math.floor(Math.random()*1e6);
}
const fmtCOP = n => (n==null||n==='') ? 'Consultar' : '$' + Number(n).toLocaleString('es-CO');

/* Escapa HTML para pintar contenido de la BD con seguridad */
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Link de WhatsApp del cliente (asume Colombia si es número local 3xx...) */
function waNum(n){
  let dig = String(n||'').replace(/[^0-9]/g,'');
  if(dig.length===10 && dig.startsWith('3')) dig = '57'+dig;
  return 'https://wa.me/'+dig;
}

/* Atributo de evento seguro: delimitado con comilla simple, JSON con dobles */
function attrEvt(evt, call){
  return evt+'=\'' + String(call).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\'';
}
function attrClick(call){ return attrEvt('onclick', call); }

/* ---------- URLs seguras para <img src> ---------- */
const SUPABASE_HOST = (function(){
  try{ return new URL(SUPABASE_CONFIG.url).host; }catch(e){ return ''; }
})();

/* Solo admite http(s) del propio proyecto Supabase o rutas relativas seguras. */
function urlSegura(url){
  const v = String(url==null?'':url).trim();
  if(!v) return '';
  if(v.startsWith('/')) return v.split('"')[0].replace(/[<>]/g,'');
  if(!/^https?:\/\//i.test(v)) return '';
  if(SUPABASE_HOST && v.toLowerCase().startsWith('https://'+SUPABASE_HOST.toLowerCase()+'/')) return v.replace(/"/g,'');
  return '';
}

/* Convierte la ruta guardada en la BD (bucket privado) en una URL firmada
   temporal. Si ya es una URL pública, se devuelve tal cual. */
async function urlFirmada(bucket, valor){
  const v = String(valor==null?'':valor).trim();
  if(!v) return '';
  if(/^https?:\/\//i.test(v)) return urlSegura(v);
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(v, 3600);
  if(error){ console.warn('No se pudo firmar', bucket + '/' + v, error.message); return ''; }
  return data ? (data.signedUrl || '') : '';
}

/* img con src ya saneado */
function imgHTML(src, alt, clase, extra){
  const s = urlSegura(src);
  if(!s) return '<i class="fa-solid fa-image"></i>';
  return '<img src="'+esc(s)+'" alt="'+esc(alt||'')+'" loading="lazy" class="'+(clase||'')+'" '+(extra||'')+'>';
}

/* ---------- Promos ---------- */
function fechaVigente(ini, fin){
  if(!ini || !fin) return false;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return hoy >= new Date(ini + 'T00:00:00') && hoy <= new Date(fin + 'T23:59:59');
}
function precioInfo(p){
  const base = (p.precio == null || p.precio === '') ? null : Number(p.precio);
  const pct = Number(p.descuento_porcentaje) || 0;
  const vigente = pct > 0 && fechaVigente(p.promo_inicio, p.promo_fin);
  const final = (base != null && vigente) ? Math.round(base * (1 - pct/100)) : base;
  return { base, pct, vigente, final, etiqueta: vigente ? (p.etiqueta_promo || 'Oferta') : '' };
}

/* ---------- Stock ---------- */
function stockValor(p){
  return (p.stock == null || p.stock === '') ? null : Number(p.stock);
}
function agotada(p){
  const s = stockValor(p);
  return s != null && s <= 0;
}

/* ---------- Supabase ---------- */
function clienteSupabase(){
  return import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .then(m => m.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key));
}

function toast(msg, tipo){
  const cont = $('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast ' + (tipo || '');
  t.innerHTML = '<i class="fa-solid '+(tipo==='error'?'fa-circle-xmark':'fa-circle-check')+'"></i><span>'+msg+'</span>';
  cont.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 500); }, 2600);
}

/* ---------- Vistas ---------- */
function mostrarLogin(){
  $('loginView').classList.remove('hidden');
  $('dashView').classList.add('hidden');
  $('loginMsg').textContent = '';
}
function mostrarDash(){
  $('loginView').classList.add('hidden');
  $('dashView').classList.remove('hidden');
  cargarCuentas();
  cargarPedidos();
}

/* El login solo habilita la sesión: la RLS exige estar en public.admins.
   Verificamos el rol para avisar con claridad y no mostrar un panel vacío. */
async function esAdmin(){
  if(!sb) return false;
  try{
    const { data, error } = await sb.rpc('es_admin');
    if(error){ console.warn('es_admin', error.message); return false; }
    return data === true;
  }catch(e){ return false; }
}

function avisoSinPermisos(correo){
  const quien = correo || 'este correo';
  const msg = 'Sesión iniciada, pero ' + quien + ' no está en la lista de administradores. '
    + 'En Supabase → SQL Editor ejecuta: insert into public.admins (email) values ('
    + (correo || "'TU@CORREO.COM'") + ');';
  if($('loginMsg')) $('loginMsg').textContent = msg;
  toast('Acceso denegado: correo sin permisos','error');
}

let accesoPermitido = false;
async function entrarAlPanel(){
  if(accesoPermitido) return;
  if(await esAdmin()){
    accesoPermitido = true;
    mostrarDash();
  }else{
    accesoPermitido = false;
    mostrarLogin();
    let correo = '';
    try{
      const { data } = await sb.auth.getUser();
      correo = (data && data.user && data.user.email) || '';
    }catch(e){}
    avisoSinPermisos(correo);
    try{ await sb.auth.signOut(); }catch(e){}
  }
}

/* ---------- Carga y pintado ---------- */
async function cargarCuentas(){
  const { data, error } = await sb.from('productos').select('*').order('orden',{ascending:true}).order('created_at',{ascending:true});
  if(error){ toast('Error al cargar productos','error'); return; }
  admCuentas = data || [];
  renderStats();
  renderFiltroCat();
  renderLista();
}

function renderStats(){
  const total = admCuentas.length;
  const activos = admCuentas.filter(p=>p.activo).length;
  const agot = admCuentas.filter(p=>p.activo && agotada(p)).length;
  const enPromo = admCuentas.filter(p=>p.activo && precioInfo(p).vigente).length;
  $('stats').innerHTML =
    '<div class="stat"><div class="ic blue"><i class="fa-solid fa-cake-candles"></i></div><div><b>'+total+'</b><small>Productos totales</small></div></div>'+
    '<div class="stat"><div class="ic green"><i class="fa-solid fa-circle-check"></i></div><div><b>'+activos+'</b><small>Activos en tienda</small></div></div>'+
    '<div class="stat"><div class="ic red"><i class="fa-solid fa-boxes-stacked"></i></div><div><b>'+agot+'</b><small>Agotados</small></div></div>'+
    '<div class="stat"><div class="ic gold"><i class="fa-solid fa-tags"></i></div><div><b>'+enPromo+'</b><small>Con promo vigente</small></div></div>';
}

function renderFiltroCat(){
  const sel = $('admFiltroCat');
  if(sel.options.length > 1) return;
  sel.innerHTML = '<option value="">Todas las categorías</option>' + CATS.map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');
}

function listaFiltrada(){
  const q = $('admSearch').value.trim().toLowerCase();
  const c = $('admFiltroCat').value;
  return admCuentas.filter(p=>{
    if(c && p.categoria !== c) return false;
    if(q && !((p.nombre||'')+(p.descripcion||'')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function catNombre(k){
  const f = CATS.find(c=>c[0]===k);
  return f ? f[1] : k;
}

function renderLista(){
  const list = listaFiltrada();
  $('admEmpty').classList.toggle('hidden', list.length>0);
  $('admList').innerHTML = list.map(p=>{
    const info = precioInfo(p);
    const stock = agotada(p)
      ? '<span class="adm-off">Agotado</span>'
      : (stockValor(p)==null ? '<span class="adm-stock">Stock libre</span>' : '<span class="adm-stock">Quedan '+stockValor(p)+'</span>');
    let precios = '<span class="precio">'+fmtCOP(p.precio);
    if(info.vigente) precios += ' <span class="p-old">'+fmtCOP(info.final)+'</span> <span class="adm-promo">-'+info.pct+'% '+(info.etiqueta||'').toUpperCase()+'</span>';
    precios += '</span>';
    const thumb = p.foto_url
      ? imgHTML(p.foto_url, '')
      : '<i class="fa-solid fa-cake-candles"></i>';
    const badge = p.activo ? '' : '<span class="adm-off">Oculto</span>';
    const aroma = p.garantia ? '<i class="fa-solid fa-circle-info"></i> '+esc(p.garantia) : '';
    return '<div class="adm-item">'+
      '<div class="thumb">'+thumb+'</div>'+
      '<div class="info">'+
        '<div class="nm">'+esc(p.nombre)+' <span class="adm-cat">'+catNombre(p.categoria)+'</span> '+(p.etiqueta?'<span class="adm-promo">'+esc(p.etiqueta)+'</span>':'')+' '+stock+' '+badge+'</div>'+
        '<div class="aroma">'+(aroma?'<span>'+aroma+'</span>':'')+'</div>'+
        precios+
      '</div>'+
      '<div class="acc">'+
        '<label class="switch'+(p.activo?' live':'')+'" title="'+(p.activo?'Activo en tienda':'Oculto de la tienda')+'"><input type="checkbox" '+(p.activo?'checked':'')+' '+attrEvt('onchange','toggleActivo('+JSON.stringify(String(p.id))+',this)')+'><i class="fa-solid '+(p.activo?'fa-eye':'fa-eye-slash')+'"></i></label>'+
        '<button title="Editar" '+attrClick('abrirForm('+JSON.stringify(String(p.id))+')')+'><i class="fa-solid fa-pen"></i></button>'+
        '<button title="Eliminar" class="del" '+attrClick('eliminarCuenta('+JSON.stringify(String(p.id))+')')+'><i class="fa-solid fa-trash-can"></i></button>'+
      '</div>'+
    '</div>';
  }).join('');
}

/* =============================================================== */
/* PEDIDOS (recibidos desde la tienda)                             */
/* =============================================================== */

async function cargarPedidos(){
  const { data, error } = await sb
    .from('solicitudes')
    .select('*')
    .order('created_at', { ascending: false });
  if(error){ console.warn('Error cargando pedidos', error); return; }
  pedidos = data || [];
  await firmarAdjuntos(pedidos);
  actualizarBadgePedidos();
  renderPedidos();
}

/* Los buckets comprobantes/referencias son privados: convertimos la ruta
   guardada en la BD en una URL firmada de 1 hora para poder mostrarla. */
async function firmarAdjuntos(lista){
  const jobs = [];
  (lista || []).forEach(s=>{
    if(s.comprobante_url){
      const bucket = (s.tipo === 'encargo') ? 'referencias' : 'comprobantes';
      jobs.push(urlFirmada(bucket, s.comprobante_url).then(u=>{ s._archivoUrl = u; }));
    }
    const d = (s.detalles && typeof s.detalles === 'object') ? s.detalles : null;
    if(d && d.referencia_url){
      jobs.push(urlFirmada('referencias', d.referencia_url).then(u=>{ d.referencia_url_firmada = u; }));
    }
  });
  if(jobs.length) await Promise.all(jobs);
}

function actualizarBadgePedidos(){
  const nP = pedidos.filter(s=>s.estado==='nueva').length;
  const b = $('badgePedidos');
  b.textContent = nP;
  b.classList.toggle('show', nP>0);
}

function setVista(v){
  const esPed = v === 'pedidos';
  const esBan = v === 'banners';
  const esGal = v === 'galeria';
  const esVen = v === 'ventas';
  const esCont = v === 'contabilidad';
  const esProd = !(esPed || esBan || esGal || esVen || esCont);
  $('productosView').classList.toggle('hidden', !esProd);
  $('pedidosView').classList.toggle('hidden', !esPed);
  $('bannersView').classList.toggle('hidden', !esBan);
  $('galeriaView').classList.toggle('hidden', !esGal);
  $('ventasView').classList.toggle('hidden', !esVen);
  $('contabilidadView').classList.toggle('hidden', !esCont);
  $('btnNavProductos').classList.toggle('active', esProd);
  $('btnNavPedidos').classList.toggle('active', esPed);
  $('btnNavBanners').classList.toggle('active', esBan);
  $('btnNavGaleria').classList.toggle('active', esGal);
  $('btnNavVentas').classList.toggle('active', esVen);
  $('btnNavContabilidad').classList.toggle('active', esCont);
  if(esPed) renderPedidos();
  if(esBan) cargarBanners();
  if(esGal) cargarGaleria();
  if(esVen) renderVentas();
  if(esCont){ inicializarContabilidad(); cargarGastos(); }
}

function estadoLabel(e){ return ({nueva:'Nueva',vista:'Vista',atendida:'Atendida',garantia:'Garantía',cerrada:'Cerrada'})[e]||e; }

function diasDesde(fecha){
  if(!fecha) return null;
  const ms = Date.now() - new Date(fecha).getTime();
  return Math.floor(ms / 86400000);
}
function haceTxt(fecha){
  const d = diasDesde(fecha);
  if(d == null) return '';
  if(d <= 0) return 'hoy';
  if(d === 1) return 'hace 1 día';
  return 'hace '+d+' días';
}

function pedidosFiltrados(){
  return pedidos.filter(s=>{
    if(!['pedido','encargo'].includes(s.tipo)) return false;
    if(solFiltro && s.estado !== solFiltro) return false;
    if(solBusqueda){
      const hay = ((s.codigo||'')+' '+(s.nombre||'')+' '+(s.whatsapp||'')+' '+(s.correo||'')+' '+(s.mensaje_wa||'')).toLowerCase();
      if(!hay.includes(solBusqueda)) return false;
    }
    return true;
  });
}

function renderPedidos(){
  const list = pedidosFiltrados();
  $('solEmpty').classList.toggle('hidden', list.length>0);
  $('solList').innerHTML = list.map(solCard).join('');
}

function detPedido(s){
  const d = (s.detalles && typeof s.detalles==='object') ? s.detalles : {};
  if(s.tipo === 'encargo') return detEncargo(d);
  const items = Array.isArray(d.items) ? d.items : [];
  const lineas = items.map(it=>{
    const sub = it.subtotal==null ? 'Consultar' : fmtCOP(it.subtotal);
    return '<div class="rl"><span>'+esc(it.nombre)+(it.presentacion?' <em>· '+esc(it.presentacion)+'</em>':'')+' × '+it.cantidad+'</span><span>'+sub+'</span></div>';
  }).join('');
  const total = d.total==null ? 'Consultar' : fmtCOP(d.total);
  return '<div class="sol-ped">'+
    '<div class="sol-items">'+lineas+'<div class="rl total"><span>Total estimado</span><b>'+total+'</b></div></div>'+
  '</div>';
}

function detEncargo(d){
  let html = '<div class="sol-items">';
  if(d.tamano || d.sabor){
    html += '<div class="enc-summary">'+
      '<div class="enc-big"><small>Tamaño</small><b>'+esc(d.tamano||'—')+'</b></div>'+
      '<div class="enc-big"><small>Sabor</small><b>'+esc(d.sabor||'—')+'</b></div>'+
    '</div>';
  }
  [['Ocasión', d.ocasion], ['Fecha del evento', d.fecha], ['Decoración', d.decoracion], ['Detalles', d.mensaje]].forEach(f=>{
    if(f[1]) html += '<div class="rl"><span>'+f[0]+'</span><span>'+esc(f[1])+'</span></div>';
  });
  if(d.referencia_url){
    const ref = d.referencia_url_firmada || '';
    html += '<div class="enc-ref">'+
      imgHTML(ref, 'Imagen de referencia', '', ref ? attrClick('abrirComprobante('+JSON.stringify(ref)+',this)') : '')+
      '<small>Imagen de referencia'+(ref ? '' : ' · no se pudo abrir')+'</small></div>';
  }
  if(d.total != null) html += '<div class="rl total"><span>Valor cotizado</span><b>'+fmtCOP(d.total)+'</b></div>';
  html += '</div>';
  return html;
}

function solCard(s){
  const d = (s.detalles && typeof s.detalles==='object') ? s.detalles : {};
  const fechaTxt = new Date(s.created_at).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const esEncargo = s.tipo === 'encargo';
  const tipoHtml = esEncargo
    ? '<span class="sol-tipo enc"><i class="fa-solid fa-cake-candles"></i>Encargo</span>'
    : '<span class="sol-tipo ped"><i class="fa-solid fa-bag-shopping"></i>Pedido</span>';

  const estados = ['nueva','vista','atendida','garantia','cerrada'];
  const contacto =
    '<div class="sol-contacto">'+
      '<span class="sol-nombre"><i class="fa-solid fa-user"></i>'+esc(s.nombre)+'</span>'+
      (s.whatsapp ? '<a href="'+waNum(s.whatsapp)+'" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>'+esc(s.whatsapp)+'</a>' : '')+
      (s.correo ? '<a href="mailto:'+esc(s.correo)+'"><i class="fa-solid fa-envelope"></i>'+esc(s.correo)+'</a>' : '')+
    '</div>';

  let pago = '';
  if(s.metodo_pago || s.comprobante_url){
    let comp = '';
    let pieComp = 'Comprobante adjunto';
    if(s.comprobante_url){
      const u = s._archivoUrl || '';
      if(!u) pieComp = 'Comprobante guardado (no se pudo firmar el enlace)';
      comp = imgHTML(u, 'Comprobante de pago', 'sol-comp-img', u ? attrClick('abrirComprobante('+JSON.stringify(u)+',this)') : '');
    }
    pago = '<div class="sol-pago">'+
        '<div class="sol-pago-head"><span class="sol-tipo ped" style="font-size:.66rem;"><i class="fa-solid fa-money-bill-wave"></i>Pago</span>'+
        (s.metodo_pago ? '<span class="sol-metodo"><i class="fa-solid fa-wallet"></i>'+esc(s.metodo_pago)+'</span>' : '')+
        (s.fecha_cierre ? '<span class="sol-fecha-cierre"><i class="fa-solid fa-circle-check"></i>Entregado '+haceTxt(s.fecha_cierre)+'</span>' : '')+
        (s.stock_descontado ? '<span class="sol-stock-tag"><i class="fa-solid fa-box"></i>Stock descontado</span>' : '')+
        '</div>'+
        (comp ? '<div class="sol-comp">'+comp+'<small>'+pieComp+'</small></div>' : '<p class="sol-sincomp">Sin captura adjunta</p>')+
      '</div>';
  }

  return '<div class="sol-card">'+
    '<div class="sol-head">'+
      '<div class="sol-left">'+
        tipoHtml+
        (s.codigo ? '<span class="sol-codigo"><i class="fa-solid fa-hashtag"></i>'+esc(s.codigo)+'</span>' : '')+
        '<span class="sol-date"><i class="fa-regular fa-clock"></i>'+fechaTxt+'</span>'+
        (s.fecha_cierre ? '<span class="sol-age"><i class="fa-solid fa-circle-check"></i>Entregado '+haceTxt(s.fecha_cierre)+'</span>' : '')+
        (haceTxt(s.created_at) ? '<span class="sol-age"><i class="fa-solid fa-calendar-days"></i>'+haceTxt(s.created_at)+'</span>' : '')+
      '</div>'+
      '<div class="sol-head-acc">'+
        '<select class="sol-estado '+s.estado+'" title="Cambiar estado" '+attrEvt('onchange','cambiarEstado('+JSON.stringify(String(s.id))+',this.value)')+'>'+
          estados.map(e=>'<option value="'+e+'"'+(s.estado===e?' selected':'')+'>'+estadoLabel(e)+'</option>').join('')+
        '</select>'+
        '<button class="acc-btn del" title="Eliminar" '+attrClick('eliminarPedido('+JSON.stringify(String(s.id))+')')+'><i class="fa-solid fa-trash-can"></i></button>'+
      '</div>'+
    '</div>'+
    contacto+
    pago+
    detPedido(d)+
    (s.mensaje_wa ? '<div class="sol-msg"><pre>'+esc(s.mensaje_wa)+'</pre></div>' : '')+
    '<div class="sol-acc">'+
      (s.whatsapp ? '<a class="btn small wa" href="'+waNum(s.whatsapp)+'" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Hablar por WhatsApp</a>' : '')+
      (esEncargo ? '<button type="button" class="btn small gold" '+attrClick('cotizarEncargo('+JSON.stringify(String(s.id))+')')+'><i class="fa-solid fa-tag"></i> Cotizar valor</button>' : '')+
      (s.mensaje_wa ? '<button type="button" class="btn small ghost" '+attrClick('copiarMensaje('+JSON.stringify(String(s.id))+')')+'><i class="fa-regular fa-copy"></i> Copiar mensaje</button>' : '')+
    '</div>'+
  '</div>';
}

async function cotizarEncargo(id){
  const s = pedidos.find(x=>String(x.id)===String(id));
  if(!s) return;
  const d = (s.detalles && typeof s.detalles==='object') ? s.detalles : {};
  const actual = (d.total != null && d.total !== '') ? Number(d.total) : 0;
  const entrada = prompt('Valor cotizado de la torta (COP):\nSe contará como ingreso en Contabilidad.', actual || '');
  if(entrada === null) return;
  const v = parseInt(String(entrada).replace(/[^0-9]/g, ''), 10);
  if(!(v >= 0)){ toast('Valor no válido','error'); return; }
  const detalles = Object.assign({}, d, { total: v });
  const { error } = await sb.from('solicitudes').update({ detalles }).eq('id', id);
  if(error){ toast('No se pudo guardar la cotización','error'); return; }
  s.detalles = detalles;
  renderPedidos();
  renderVentas();
  if(typeof contMesActivo === 'string') renderContabilidad();
  toast('Valor cotizado: '+fmtCOP(v));
}

async function cambiarEstado(id, estado){
  const s0 = pedidos.find(x=>String(x.id)===String(id));
  if(estado === 'atendida' && s0 && s0.tipo === 'encargo'){
    /* Encargo: no hay stock del catálogo que descontar ni importes de ítems */
    const payload = { estado: 'atendida', fecha_cierre: new Date().toISOString() };
    const { error } = await sb.from('solicitudes').update(payload).eq('id', id);
    if(error){ toast('No se pudo actualizar el estado','error'); renderPedidos(); return; }
    s0.estado = 'atendida'; s0.fecha_cierre = payload.fecha_cierre;
    actualizarBadgePedidos();
    renderPedidos();
    renderVentas();
    toast('Encargo marcado como atendido');
    return;
  }
  if(estado === 'atendida'){
    const { data, error } = await sb.rpc('cerrar_venta', { p_id: id });
    if(error){ toast('No se pudo cerrar la venta','error'); renderPedidos(); return; }
    const s = pedidos.find(x=>String(x.id)===String(id));
    if(s){ s.estado = 'atendida'; s.stock_descontado = true; s.fecha_cierre = new Date().toISOString(); }
    actualizarBadgePedidos();
    renderPedidos();
    renderVentas();
    cargarCuentas();
    toast(data ? 'Venta cerrada · stock descontado' : 'La venta ya tenía el stock descontado');
    return;
  }

  const payload = { estado };
  if(estado === 'garantia') payload.fecha_garantia = new Date().toISOString();

  const { error } = await sb.from('solicitudes').update(payload).eq('id', id);
  if(error){ toast('No se pudo actualizar el estado','error'); renderPedidos(); return; }
  const s = pedidos.find(x=>String(x.id)===String(id));
  if(s){ s.estado = estado; if(estado==='garantia') s.fecha_garantia = payload.fecha_garantia; }
  actualizarBadgePedidos();
  renderPedidos();
  renderVentas();
  toast('Estado actualizado: '+estadoLabel(estado));
}

async function eliminarPedido(id){
  if(!confirm('¿Eliminar este pedido definitivamente?')) return;
  const s = pedidos.find(x=>String(x.id)===String(id));
  const { error } = await sb.from('solicitudes').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar','error'); return; }
  /* El adjunto vive en un bucket privado: lo borramos aparte */
  if(s && s.comprobante_url) await quitarArchivoDeUrl(s.comprobante_url, s.tipo==='encargo' ? 'referencias' : 'comprobantes');
  pedidos = pedidos.filter(x=>String(x.id)!==String(id));
  actualizarBadgePedidos();
  renderPedidos();
  renderVentas();
  toast('Pedido eliminado');
}

/* ---------- Ventas (registro de ventas cerradas + garantías) ---------- */
function ventasFiltradas(){
  return pedidos.filter(s=>{
    if(s.tipo !== 'pedido') return false;
    if(!s.stock_descontado) return false;
    if(ventaFiltroEstado && s.estado !== ventaFiltroEstado) return false;
    if(ventaFiltroMetodo && (s.metodo_pago||'') !== ventaFiltroMetodo) return false;
    if(ventaBusqueda){
      const hay = ((s.codigo||'')+' '+(s.nombre||'')+' '+(s.whatsapp||'')).toLowerCase();
      if(!hay.includes(ventaBusqueda)) return false;
    }
    return true;
  });
}

let ventaStatsGlob = { ventas:0, ingresos:0, unidades:0, garantias:0 };

function renderVentas(){
  const filtradas = ventasFiltradas();
  const importes = filtradas.map(s=>({
    total: (s.detalles && s.detalles.total!=null) ? Number(s.detalles.total) : 0,
    unidades: (Array.isArray(s.detalles&&s.detalles.items)?s.detalles.items:[]).reduce((a,it)=>a+(Number(it.cantidad)||0),0)
  }));
  ventaStatsGlob = {
    ventas: filtradas.length,
    ingresos: importes.reduce((a,r)=>a+r.total,0),
    unidades: importes.reduce((a,r)=>a+r.unidades,0),
    garantias: filtradas.filter(s=>s.estado==='garantia').length
  };
  $('ventaStats').innerHTML =
    '<div class="stat"><div class="ic green"><i class="fa-solid fa-bag-shopping"></i></div><div><b>'+ventaStatsGlob.ventas+'</b><small>Ventas cerradas</small></div></div>'+
    '<div class="stat"><div class="ic blue"><i class="fa-solid fa-sack-dollar"></i></div><div><b>'+fmtCOP(ventaStatsGlob.ingresos)+'</b><small>Ingresos estimados</small></div></div>'+
    '<div class="stat"><div class="ic gold"><i class="fa-solid fa-boxes-stacked"></i></div><div><b>'+ventaStatsGlob.unidades+'</b><small>Productos vendidos</small></div></div>'+
    '<div class="stat"><div class="ic red"><i class="fa-solid fa-shield-halved"></i></div><div><b>'+ventaStatsGlob.garantias+'</b><small>Garantías activas</small></div></div>';

  $('ventaEmpty').classList.toggle('hidden', filtradas.length>0);
  $('ventaList').innerHTML = filtradas.map(ventaCard).join('');
}

function ventaCard(s){
  const d = (s.detalles && typeof s.detalles==='object') ? s.detalles : {};
  const items = Array.isArray(d.items) ? d.items : [];
  const lineas = items.map(it=>
    '<div class="rl"><span>'+esc(it.nombre)+(it.presentacion?' <em>· '+esc(it.presentacion)+'</em>':'')+' × '+it.cantidad+'</span><span>'+(it.subtotal==null?'Consultar':fmtCOP(it.subtotal))+'</span></div>'
  ).join('');
  const total = (d.total==null) ? 'Consultar' : fmtCOP(d.total);
  return '<div class="sol-card venta">'+
    '<div class="sol-head">'+
      '<div class="sol-left">'+
        (s.codigo ? '<span class="sol-codigo"><i class="fa-solid fa-hashtag"></i>'+esc(s.codigo)+'</span>' : '<span class="sol-tipo ped"><i class="fa-solid fa-bag-shopping"></i>Venta</span>')+
        (s.fecha_cierre ? '<span class="sol-age"><i class="fa-solid fa-circle-check"></i>Cerrada '+haceTxt(s.fecha_cierre)+'</span>' : '')+
      '</div>'+
      '<div class="sol-head-acc">'+
        '<span class="sol-estado '+s.estado+'">'+estadoLabel(s.estado)+'</span>'+
        (s.stock_descontado ? '<span class="sol-stock-tag"><i class="fa-solid fa-box"></i>Stock descontado</span>' : '')+
      '</div>'+
    '</div>'+
    '<div class="sol-contacto">'+
      '<span class="sol-nombre"><i class="fa-solid fa-user"></i>'+esc(s.nombre)+'</span>'+
      (s.metodo_pago ? '<span class="sol-metodo"><i class="fa-solid fa-wallet"></i>'+esc(s.metodo_pago)+'</span>' : '')+
      (s.whatsapp ? '<a href="'+waNum(s.whatsapp)+'" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>'+esc(s.whatsapp)+'</a>' : '')+
    '</div>'+
    '<div class="sol-ped">'+
      '<div class="sol-items">'+(lineas||'<div class="rl">Sin ítems</div>')+'<div class="rl total"><span>Total</span><b>'+total+'</b></div></div>'+
    '</div>'+
    (s.fecha_garantia ? '<p class="hint" style="margin:.5rem 0 0;"><i class="fa-solid fa-shield-halved"></i> Garantía desde '+new Date(s.fecha_garantia).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'})+'</p>' : '')+
  '</div>';
}

async function copiarMensaje(id){
  const s = pedidos.find(x=>String(x.id)===String(id));
  if(!s || !s.mensaje_wa) return;
  try{
    await navigator.clipboard.writeText(s.mensaje_wa);
  }catch(e){
    const ta = document.createElement('textarea');
    ta.value = s.mensaje_wa;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Mensaje copiado al portapapeles');
}

/* ---------- Comprobante (lightbox) ---------- */
function abrirComprobante(url, img){
  const seguro = urlSegura(url);
  if(!seguro){ toast('No se pudo abrir el archivo (bucket privado sin URL firmada)','error'); return; }
  const m = $('compModal');
  const im = $('compImg');
  im.src = seguro;
  const cap = $('compCaption');
  cap.textContent = img ? (img.alt || 'Comprobante de pago') : 'Comprobante de pago';
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cerrarComprobante(){
  $('compModal').classList.remove('open');
  document.body.style.overflow = '';
}

/* =============================================================== */
/* BANNERS (publicidad)                                            */
/* =============================================================== */
async function cargarBanners(){
  const { data, error } = await sb.from('banners').select('*').order('orden',{ascending:true}).order('created_at',{ascending:true});
  if(error){ toast('Error al cargar banners','error'); return; }
  banners = data || [];
  renderBannerStats();
  renderBannerLista();
}

function renderBannerStats(){
  const total = banners.length;
  const activos = banners.filter(b=>b.activo).length;
  $('bannerStats').innerHTML =
    '<div class="stat"><div class="ic blue"><i class="fa-solid fa-bullhorn"></i></div><div><b>'+total+'</b><small>Banners totales</small></div></div>'+
    '<div class="stat"><div class="ic green"><i class="fa-solid fa-circle-check"></i></div><div><b>'+activos+'</b><small>Activos en tienda</small></div></div>';
}

function bannerThumb(b){
  return b.imagen_url
    ? imgHTML(b.imagen_url, '')
    : '<div class="bthumb-ph">'+esc(b.titulo||'Banner')+'</div>';
}

function renderBannerLista(){
  const list = banners;
  $('bannerEmpty') && $('bannerEmpty').classList.toggle('hidden', list.length>0);
  $('bannerList').innerHTML = list.map(b=>{
    const badge = b.activo ? '' : '<span class="adm-off">Oculto</span>';
    return '<div class="adm-item">'+
      '<div class="thumb" style="width:92px;height:52px;">'+bannerThumb(b)+'</div>'+
      '<div class="info">'+
        '<div class="nm">'+esc(b.titulo||'(sin título)')+' <span class="adm-cat">Or '+esc(String(b.orden))+'</span> '+badge+'</div>'+
        (b.subtitulo ? '<div class="aroma">'+esc(b.subtitulo)+'</div>' : '')+
        (b.enlace ? '<div class="aroma"><i class="fa-solid fa-link"></i> '+esc(b.enlace)+'</div>' : '')+
      '</div>'+
      '<div class="acc">'+
        '<label class="switch'+(b.activo?' live':'')+'" title="'+(b.activo?'Activo en tienda':'Oculto de la tienda')+'"><input type="checkbox" '+(b.activo?'checked':'')+' '+attrEvt('onchange','toggleBannerActivo('+JSON.stringify(String(b.id))+',this)')+'><i class="fa-solid '+(b.activo?'fa-eye':'fa-eye-slash')+'"></i></label>'+
        '<button title="Editar" '+attrClick('abrirBannerForm('+JSON.stringify(String(b.id))+')')+'><i class="fa-solid fa-pen"></i></button>'+
        '<button title="Eliminar" class="del" '+attrClick('eliminarBanner('+JSON.stringify(String(b.id))+')')+'><i class="fa-solid fa-trash-can"></i></button>'+
      '</div>'+
    '</div>';
  }).join('');
}

async function toggleBannerActivo(id, chk){
  const ok = chk.checked;
  const { error } = await sb.from('banners').update({ activo: ok }).eq('id', id);
  if(error){ toast('No se pudo actualizar','error'); cargarBanners(); return; }
  toast(ok ? 'Banner visible en la tienda' : 'Banner oculto de la tienda');
  cargarBanners();
}

async function eliminarBanner(id){
  const b = banners.find(x=>String(x.id)===String(id));
  if(!b) return;
  if(!confirm('¿Eliminar "'+(b.titulo||'sin título')+'" definitivamente?')) return;
  const { error } = await sb.from('banners').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar','error'); return; }
  if(b.imagen_url) await quitarArchivoDeUrl(b.imagen_url, 'banners');
  toast('Banner eliminado');
  cargarBanners();
}

function abrirBannerForm(id){
  editandoBannerId = id ? String(id) : null;
  bannerFotoPendiente = null;
  quitarBannerFoto = false;
  $('bannerFormMsg').textContent = '';
  $('bannerModTitle').textContent = editandoBannerId ? 'Editar banner' : 'Nuevo banner';

  const limpiarFoto = ()=>{
    $('bfotoPreviewWrap').classList.add('hidden');
    $('bfotoDrop').classList.remove('hidden');
  };

  if(editandoBannerId){
    const b = banners.find(x=>String(x.id)===editandoBannerId) || {};
    $('bfTitulo').value = b.titulo || '';
    $('bfSubtitulo').value = b.subtitulo || '';
    $('bfEnlace').value = b.enlace || '';
    $('bfOrden').value = (b.orden == null) ? 0 : String(b.orden);
    $('bfActivo').checked = b.activo !== false;
    if(b.imagen_url){
      $('bfotoPreview').src = urlSegura(b.imagen_url);
      $('bfotoPreviewWrap').classList.remove('hidden');
      $('bfotoDrop').classList.add('hidden');
    }else{
      limpiarFoto();
    }
  }else{
    $('bannerForm').reset();
    $('bfActivo').checked = true;
    $('bfOrden').value = '0';
    limpiarFoto();
  }

  $('bannerFormModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cerrarBannerForm(){
  $('bannerFormModal').classList.remove('open');
  document.body.style.overflow = '';
}

function prepararBannerFoto(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){
    toast('El archivo debe ser una imagen','error');
    return;
  }
  if(file.size > 5 * 1024 * 1024){
    toast('La imagen supera los 5 MB','error');
    return;
  }
  bannerFotoPendiente = file;
  quitarBannerFoto = false;
  $('bfotoPreview').src = URL.createObjectURL(file);
  $('bfotoPreviewWrap').classList.remove('hidden');
  $('bfotoDrop').classList.add('hidden');
}

async function guardarBanner(e){
  e.preventDefault();
  const btn = $('btnGuardarBanner');
  btn.disabled = true;

  try{
    const payload = {
      titulo: $('bfTitulo').value.trim(),
      subtitulo: $('bfSubtitulo').value.trim(),
      enlace: $('bfEnlace').value.trim(),
      orden: parseInt($('bfOrden').value, 10) || 0,
      activo: $('bfActivo').checked
    };

    let imgUrl = editandoBannerId ? ((banners.find(x=>String(x.id)===editandoBannerId)||{}).imagen_url || '') : '';
    if(bannerFotoPendiente){
      const urlNueva = await subirArchivo(bannerFotoPendiente, 'banners');
      if(imgUrl) await quitarArchivoDeUrl(imgUrl, 'banners');
      imgUrl = urlNueva;
    }else if(editandoBannerId && quitarBannerFoto){
      if(imgUrl) await quitarArchivoDeUrl(imgUrl, 'banners');
      imgUrl = '';
    }
    payload.imagen_url = imgUrl;

    let error = null;
    if(editandoBannerId){
      ({ error } = await sb.from('banners').update(payload).eq('id', editandoBannerId));
    }else{
      ({ error } = await sb.from('banners').insert([payload]));
    }
    if(error) throw error;

    toast(editandoBannerId ? 'Banner actualizado' : 'Banner creado');
    cerrarBannerForm();
    cargarBanners();
  }catch(err){
    console.error(err);
    $('bannerFormMsg').textContent = (err && err.message) ? err.message : 'Ocurrió un error al guardar.';
  }finally{
    btn.disabled = false;
  }
}

/* =============================================================== */
/* GALERÍA · CLIENTES FELICES (carrusel de la tienda)               */
/* =============================================================== */
let galeria = [];
let editandoGaleriaId = null;
let galeriaFotoPendiente = null;
let quitarGaleriaFoto = false;

const MIME_GALERIA = ['image/jpeg','image/png','image/webp'];
const MAX_MB_GALERIA = 5;

async function cargarGaleria(){
  const { data, error } = await sb
    .from('galeria').select('*')
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if(error){ toast('No se pudo cargar la galería','error'); return; }
  galeria = data || [];
  renderGaleriaStats();
  renderGaleriaLista();
}

function renderGaleriaStats(){
  const total = galeria.length;
  const activos = galeria.filter(g=>g.activo).length;
  const sinFoto = galeria.filter(g=>!g.imagen_url).length;
  $('galeriaStats').innerHTML =
    '<div class="stat"><div class="ic blue"><i class="fa-solid fa-camera-retro"></i></div><div><b>'+total+'</b><small>Fotos totales</small></div></div>'+
    '<div class="stat"><div class="ic green"><i class="fa-solid fa-circle-check"></i></div><div><b>'+activos+'</b><small>Visibles en tienda</small></div></div>'+
    '<div class="stat"><div class="ic '+(sinFoto?'red':'gold')+'"><i class="fa-solid '+(sinFoto?'fa-triangle-exclamation':'fa-images')+'"></i></div><div><b>'+(sinFoto||'0')+'</b><small>Sin imagen</small></div></div>';
}

function renderGaleriaLista(){
  const list = galeria;
  $('galeriaEmpty').classList.toggle('hidden', list.length > 0);
  $('galeriaList').innerHTML = list.map((g, i) =>
    '<div class="gal-card'+(g.activo?'':' off')+'">'+
      '<div class="gal-thumb">'+
        imgHTML(g.imagen_url, g.titulo || 'Foto de cliente')+
        (g.activo ? '' : '<span class="gal-flag">Oculta</span>')+
        '<span class="gal-pos">#'+(i+1)+'</span>'+
      '</div>'+
      '<div class="gal-info">'+
        '<b>'+esc(g.titulo || '(sin título)')+'</b>'+
        (g.texto ? '<span>'+esc(g.texto)+'</span>' : '')+
        '<small>Orden '+(Number(g.orden)||0)+'</small>'+
      '</div>'+
      '<div class="gal-acc">'+
        '<label class="switch'+(g.activo?' live':'')+'" title="'+(g.activo?'Visible en la tienda':'Oculta de la tienda')+'">'+
          '<input type="checkbox" '+(g.activo?'checked':'')+' '+attrEvt('onchange','toggleGaleriaActivo('+JSON.stringify(String(g.id))+',this)')+'><i class="fa-solid '+(g.activo?'fa-eye':'fa-eye-slash')+'"></i></label>'+
        '<button type="button" title="Subir en la lista" '+(i===0?'disabled':'')+' '+attrClick('moverEnGaleria('+JSON.stringify(String(g.id))+',-1)')+'><i class="fa-solid fa-arrow-up"></i></button>'+
        '<button type="button" title="Bajar en la lista" '+(i===list.length-1?'disabled':'')+' '+attrClick('moverEnGaleria('+JSON.stringify(String(g.id))+',1)')+'><i class="fa-solid fa-arrow-down"></i></button>'+
        '<button type="button" title="Editar" '+attrClick('abrirGaleriaForm('+JSON.stringify(String(g.id))+')')+'><i class="fa-solid fa-pen"></i></button>'+
        '<button type="button" class="del" title="Eliminar" '+attrClick('eliminarGaleria('+JSON.stringify(String(g.id))+')')+'><i class="fa-solid fa-trash-can"></i></button>'+
      '</div>'+
    '</div>'
  ).join('');
}

async function toggleGaleriaActivo(id, chk){
  const ok = chk.checked;
  const { error } = await sb.from('galeria').update({ activo: ok }).eq('id', id);
  if(error){ toast('No se pudo actualizar','error'); chk.checked = !ok; return; }
  toast(ok ? 'Foto visible en la tienda' : 'Foto oculta de la tienda');
  cargarGaleria();
}

async function moverEnGaleria(id, dir){
  const i = galeria.findIndex(x=>String(x.id)===String(id));
  const j = i + dir;
  if(i < 0 || j < 0 || j >= galeria.length) return;
  const arr = galeria.slice();
  const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  arr.forEach((g,k)=>{ g.orden = k + 1; });
  renderGaleriaLista();
  for(const g of arr){
    const { error } = await sb.from('galeria').update({ orden: g.orden }).eq('id', g.id);
    if(error){ toast('No se pudo guardar el nuevo orden','error'); cargarGaleria(); return; }
  }
}

async function eliminarGaleria(id){
  const g = galeria.find(x=>String(x.id)===String(id));
  if(!g) return;
  if(!confirm('¿Eliminar "'+(g.titulo||'esta foto')+'" definitivamente?')) return;
  const { error } = await sb.from('galeria').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar','error'); return; }
  if(g.imagen_url) await quitarArchivoDeUrl(g.imagen_url, 'galeria');
  toast('Foto eliminada');
  cargarGaleria();
}

/* ---------- Formulario ---------- */
function abrirGaleriaForm(id){
  editandoGaleriaId = id ? String(id) : null;
  galeriaFotoPendiente = null;
  quitarGaleriaFoto = false;
  $('galeriaFormMsg').textContent = '';
  $('galeriaModTitle').textContent = editandoGaleriaId ? 'Editar foto' : 'Nueva foto';

  const limpiarFoto = ()=>{
    $('gfPreviewWrap').classList.add('hidden');
    $('gfDrop').classList.remove('hidden');
    $('gfPreview').removeAttribute('src');
  };

  if(editandoGaleriaId){
    const g = galeria.find(x=>String(x.id)===editandoGaleriaId) || {};
    $('gfTitulo').value = g.titulo || '';
    $('gfTexto').value = g.texto || '';
    $('gfOrden').value = (g.orden == null) ? (galeria.length + 1) : String(g.orden);
    $('gfActivo').checked = g.activo !== false;
    if(g.imagen_url){
      $('gfPreview').src = urlSegura(g.imagen_url);
      $('gfPreviewWrap').classList.remove('hidden');
      $('gfDrop').classList.add('hidden');
    }else{
      limpiarFoto();
    }
  }else{
    $('galeriaForm').reset();
    $('gfOrden').value = String(galeria.length + 1);
    $('gfActivo').checked = true;
    limpiarFoto();
  }
  $('galeriaFormModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarGaleriaForm(){
  $('galeriaFormModal').classList.remove('open');
  document.body.style.overflow = '';
  editandoGaleriaId = null;
  galeriaFotoPendiente = null;
  quitarGaleriaFoto = false;
}

function prepararGaleriaFoto(file){
  if(!file) return;
  if(MIME_GALERIA.indexOf(file.type) < 0){
    $('galeriaFormMsg').textContent = 'Usa una imagen JPG, PNG o WebP.';
    return;
  }
  if(file.size > MAX_MB_GALERIA * 1024 * 1024){
    $('galeriaFormMsg').textContent = 'La imagen supera los ' + MAX_MB_GALERIA + ' MB.';
    return;
  }
  galeriaFotoPendiente = file;
  quitarGaleriaFoto = false;
  $('galeriaFormMsg').textContent = '';
  $('gfPreview').src = URL.createObjectURL(file);
  $('gfPreviewWrap').classList.remove('hidden');
  $('gfDrop').classList.add('hidden');
}

async function guardarGaleria(e){
  e.preventDefault();
  const btn = $('btnGuardarGaleria');
  const msg = $('galeriaFormMsg');
  msg.textContent = '';

  if(!editandoGaleriaId && !galeriaFotoPendiente){
    msg.textContent = 'Selecciona la foto del cliente.';
    return;
  }
  if(galeriaFotoPendiente && galeriaFotoPendiente.size > MAX_MB_GALERIA * 1024 * 1024){
    msg.textContent = 'La imagen supera los ' + MAX_MB_GALERIA + ' MB.';
    return;
  }

  const anterior = editandoGaleriaId
    ? (galeria.find(x=>String(x.id)===editandoGaleriaId) || {})
    : {};

  const payload = {
    titulo: $('gfTitulo').value.trim().slice(0, 80),
    texto: $('gfTexto').value.trim().slice(0, 240),
    orden: (parseInt($('gfOrden').value, 10) || 0),
    activo: $('gfActivo').checked,
    imagen_url: ''
  };

  btn.disabled = true;
  try{
    if(galeriaFotoPendiente) payload.imagen_url = await subirArchivoPublico(galeriaFotoPendiente, 'galeria');
    else if(quitarGaleriaFoto) payload.imagen_url = '';
    else payload.imagen_url = anterior.imagen_url || '';

    let error;
    if(editandoGaleriaId){
      ({ error } = await sb.from('galeria').update(payload).eq('id', editandoGaleriaId));
    }else{
      ({ error } = await sb.from('galeria').insert([payload]));
    }
    if(error) throw error;

    /* Si se reemplazó o quitó la imagen, borramos el archivo viejo */
    if(anterior.imagen_url && anterior.imagen_url !== payload.imagen_url){
      await quitarArchivoDeUrl(anterior.imagen_url, 'galeria');
    }

    toast(editandoGaleriaId ? 'Foto actualizada' : 'Foto publicada en la galería');
    cerrarGaleriaForm();
    cargarGaleria();
  }catch(err){
    console.error(err);
    msg.textContent = (err && err.message) ? err.message : 'Ocurrió un error al guardar la foto.';
  }finally{
    btn.disabled = false;
  }
}

/* ---------- Acciones ---------- */
async function toggleActivo(id, chk){
  const ok = chk.checked;
  const { error } = await sb.from('productos').update({ activo: ok }).eq('id', id);
  if(error){ toast('No se pudo actualizar','error'); cargarCuentas(); return; }
  toast(ok ? 'Producto visible en la tienda' : 'Producto oculto de la tienda');
  cargarCuentas();
}

async function eliminarCuenta(id){
  const p = admCuentas.find(x=>String(x.id)===String(id));
  if(!p) return;
  if(!confirm('¿Eliminar "'+(p.nombre||'este producto')+'" definitivamente?')) return;
  const { error } = await sb.from('productos').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar','error'); return; }
  if(p.foto_url) await quitarFotoDeUrl(p.foto_url);
  toast('Producto eliminado');
  cargarCuentas();
}

/* ---------- Storage ---------- */
async function subirArchivo(file, bucket){
  bucket = bucket || 'productos';
  const path = bucket + '/' + uid() + '_' + file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: true });
  if(error) throw error;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
/* Sube a un bucket público y devuelve la URL pública (bucket "galeria"). */
async function subirArchivoPublico(file, bucket){
  bucket = bucket || 'galeria';
  const ext = (String(file.type || '').split('/')[1] || 'jpg').replace('jpeg','jpg').replace(/[^a-z0-9]/gi,'');
  const path = bucket + '/' + uid() + '.' + (ext || 'jpg');
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
  if(error) throw error;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
/* Acepta una ruta relativa ("galeria/x.jpg") o una URL completa del bucket. */
async function quitarArchivoDeUrl(url, bucket){
  try{
    bucket = bucket || 'productos';
    const v = String(url == null ? '' : url);
    if(!v) return;
    let path = '';
    if(!/^https?:\/\//i.test(v)){
      if(v.split('/')[0] === bucket) path = v;
    }else{
      const marca = '/' + bucket + '/';
      const idx = v.indexOf(marca);
      if(idx < 0) return;
      path = decodeURIComponent(v.slice(idx + marca.length).split('?')[0]);
    }
    if(!path) return;
    await sb.storage.from(bucket).remove([path]);
  }catch(e){ console.warn('No se pudo borrar el archivo', e); }
}
async function subirArchivoCuenta(file){
  return subirArchivo(file, 'productos');
}
async function quitarFotoDeUrl(url){
  return quitarArchivoDeUrl(url, 'productos');
}

/* ---------- Contabilidad (P&L mensual + gastos) ---------- */
let gastosDB = [];
let contMesActivo = '';

function inicializarContabilidad(){
  const mes = $('contMes');
  if(!mes.value){
    const hoy = new Date();
    mes.value = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
  }
  contMesActivo = mes.value;
  renderContabilidad();
  renderGastos();
}

async function cargarGastos(){
  const { data, error } = await sb.from('gastos').select('*').order('fecha', { ascending: false });
  if(error){ toast('No se pudieron cargar los gastos','error'); return; }
  gastosDB = data || [];
  if(contMesActivo) renderGastos();
}

function enMes(fecha, mes){
  if(!fecha) return false;
  return String(fecha).slice(0, 7) === mes;
}

function renderContabilidad(){
  const mes = contMesActivo;
  const vendidos = pedidos.filter(s=>{
    const cerrado = s.tipo === 'pedido'
      ? s.stock_descontado
      : ['atendida','cerrada','garantia'].includes(s.estado);
    return cerrado && enMes(s.fecha_cierre || s.created_at, mes);
  });

  let ingresos = 0;
  let costoVentas = 0;
  let numCatalogos = 0;
  let numEncargos = 0;
  vendidos.forEach(s=>{
    const d = (s.detalles && typeof s.detalles==='object') ? s.detalles : {};
    const total = (d.total != null && d.total !== '') ? Number(d.total) : 0;
    ingresos += total;
    costoVentas += Number(d.costo_total) || 0;
    if(s.tipo === 'encargo') numEncargos++; else numCatalogos++;
  });

  const gastosDelMes = gastosDB.filter(g=>enMes(g.fecha, mes)).reduce((a,g)=>a + (Number(g.valor)||0), 0);
  const utilidadBruta = ingresos - costoVentas;
  const utilidadNeta = utilidadBruta - gastosDelMes;
  const margen = ingresos > 0 ? Math.round((utilidadNeta / ingresos) * 100) : 0;

  const mesTxt = new Date(mes + '-01T00:00:00').toLocaleDateString('es-CO', { month:'long', year:'numeric' });

  $('contStats').innerHTML =
    '<div class="stat"><div class="ic blue"><i class="fa-solid fa-sack-dollar"></i></div><div><b>'+fmtCOP(ingresos)+'</b><small>Ingresos · '+esc(mesTxt)+'</small></div></div>'+
    '<div class="stat"><div class="ic red"><i class="fa-solid fa-boxes-stacked"></i></div><div><b>'+fmtCOP(costoVentas)+'</b><small>Costo de ventas</small></div></div>'+
    '<div class="stat"><div class="ic gold"><i class="fa-solid fa-scale-balanced"></i></div><div><b>'+fmtCOP(utilidadBruta)+'</b><small>Utilidad bruta</small></div></div>'+
    '<div class="stat"><div class="ic '+(utilidadNeta >= 0 ? 'green' : 'red')+'"><i class="fa-solid '+(utilidadNeta >= 0 ? 'fa-coins' : 'fa-triangle-exclamation')+'"></i></div><div><b>'+fmtCOP(utilidadNeta)+'</b><small>Utilidad neta</small></div></div>';

  $('contDesglose').innerHTML =
    '<div class="dl"><span>Pedidos del catálogo cerrados</span><b>'+numCatalogos+'</b></div>'+
    '<div class="dl"><span>Encargos personalizados atendidos</span><b>'+numEncargos+'</b></div>'+
    '<div class="dl"><span>Ingresos</span><b>'+fmtCOP(ingresos)+'</b></div>'+
    '<div class="dl"><span>Costo de lo vendido</span><b>'+fmtCOP(costoVentas)+'</b></div>'+
    '<div class="dl"><span>Gastos del mes</span><b>'+fmtCOP(gastosDelMes)+'</b></div>'+
    '<div class="dl neta"><span>Utilidad neta</span><b>'+fmtCOP(utilidadNeta)+'</b></div>'+
    '<div class="dl"><span>Margen sobre ingresos</span><b>'+margen+'%</b></div>';
}

function renderGastos(){
  if(!contMesActivo) return;
  const lista = gastosDB.filter(g=>enMes(g.fecha, contMesActivo));
  $('gastosEmpty').classList.toggle('hidden', lista.length > 0);
  $('gastosList').innerHTML = lista.map(g=>
    '<div class="gasto-row">'+
      '<div class="gasto-ico"><i class="fa-solid fa-receipt"></i></div>'+
      '<div class="gasto-info"><b>'+esc(g.concepto)+'</b><span>'+esc(g.categoria||'Otro')+(g.descripcion ? ' · '+esc(g.descripcion) : '')+'</span></div>'+
      '<div class="gasto-monto">'+fmtCOP(g.valor)+'<small>'+String(g.fecha||'').slice(0,10)+'</small></div>'+
      '<button type="button" class="acc-btn del" title="Eliminar" '+attrClick('eliminarGasto('+JSON.stringify(String(g.id))+')')+'><i class="fa-solid fa-trash-can"></i></button>'+
    '</div>'
  ).join('');
}

function abrirGastoForm(){
  $('gastoForm').reset();
  $('gFecha').value = new Date().toISOString().slice(0, 10);
  $('gConcepto').value = '';
  $('gValor').value = '';
  $('gDescripcion').value = '';
  $('gastoForm').classList.remove('hidden');
  $('btnNuevoGasto').classList.add('hidden');
  $('gConcepto').focus();
}
function cerrarGastoForm(){
  $('gastoForm').classList.add('hidden');
  $('btnNuevoGasto').classList.remove('hidden');
}

async function guardarGasto(e){
  e.preventDefault();
  const concepto = $('gConcepto').value.trim();
  if(!concepto){ toast('Escribe el concepto del gasto','warn'); return; }
  const valor = parseInt($('gValor').value, 10);
  if(!(valor >= 0)){ toast('Escribe un valor válido','warn'); return; }
  const payload = {
    concepto,
    categoria: $('gCategoria').value,
    valor,
    descripcion: $('gDescripcion').value.trim(),
    fecha: $('gFecha').value || new Date().toISOString().slice(0, 10)
  };
  const { error } = await sb.from('gastos').insert([payload]);
  if(error){ toast('No se pudo guardar el gasto','error'); return; }
  cerrarGastoForm();
  toast('Gasto registrado');
  cargarGastos();
  renderContabilidad();
}

async function eliminarGasto(id){
  if(!confirm('¿Eliminar este gasto definitivamente?')) return;
  const { error } = await sb.from('gastos').delete().eq('id', id);
  if(error){ toast('No se pudo eliminar','error'); return; }
  gastosDB = gastosDB.filter(g=>String(g.id)!==String(id));
  renderGastos();
  renderContabilidad();
  toast('Gasto eliminado');
}

/* ---------- Formulario ---------- */
function abrirForm(id){
  editandoId = id ? String(id) : null;
  fotoPendiente = null;
  quitarFoto = false;

  $('formMsg').textContent = '';
  $('modTitle').textContent = editandoId ? 'Editar producto' : 'Nuevo producto';

  if(editandoId){
    const p = admCuentas.find(x=>String(x.id)===editandoId) || {};
    $('fNombre').value = p.nombre || '';
    $('fCategoria').value = p.categoria || CATS[0][0];
    $('fStock').value = (p.stock == null || p.stock === '') ? '' : String(p.stock);
    $('fPrecio').value = (p.precio == null || p.precio === '') ? '' : String(p.precio);
    $('fCosto').value = (p.costo == null || p.costo === '') ? '' : String(p.costo);
    $('fGarantia').value = p.garantia || '';
    $('fEtiqueta').value = p.etiqueta || '';
    $('fDescripcion').value = p.descripcion || '';
    $('fDescuento').value = p.descuento_porcentaje ? String(p.descuento_porcentaje) : '';
    $('fEtiquetaPromo').value = p.etiqueta_promo || '';
    $('fInicio').value = p.promo_inicio || '';
    $('fFin').value = p.promo_fin || '';
    $('fActivo').checked = p.activo !== false;

  if(p.foto_url){
    $('fotoPreview').src = urlSegura(p.foto_url);
      $('fotoPreviewWrap').classList.remove('hidden');
      $('fotoDrop').classList.add('hidden');
    }else{
      $('fotoPreviewWrap').classList.add('hidden');
      $('fotoDrop').classList.remove('hidden');
    }
  }else{
    $('productForm').reset();
    $('fActivo').checked = true;
    $('fotoPreviewWrap').classList.add('hidden');
    $('fotoDrop').classList.remove('hidden');
  }

  $('formModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cerrarForm(){
  $('formModal').classList.remove('open');
  document.body.style.overflow = '';
}

function prepararFoto(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){
    toast('El archivo debe ser una imagen','error');
    return;
  }
  if(file.size > 5 * 1024 * 1024){
    toast('La imagen supera los 5 MB','error');
    return;
  }
  fotoPendiente = file;
  quitarFoto = false;
  $('fotoPreview').src = URL.createObjectURL(file);
  $('fotoPreviewWrap').classList.remove('hidden');
  $('fotoDrop').classList.add('hidden');
}

async function guardarCuenta(e){
  e.preventDefault();
  const btn = $('btnGuardar');
  btn.disabled = true;

  try{
    const nombre = $('fNombre').value.trim();
    if(!nombre){ $('formMsg').textContent = 'El nombre es obligatorio.'; btn.disabled = false; return; }

    const precioVal = $('fPrecio').value.trim();
    const descuentoVal = $('fDescuento').value.trim();
    const stockVal = $('fStock').value.trim();
    const costoVal = $('fCosto').value.trim();
    const payload = {
      nombre,
      categoria: $('fCategoria').value,
      descripcion: $('fDescripcion').value.trim(),
      stock: stockVal === '' ? null : Math.max(0, parseInt(stockVal, 10)),
      precio: precioVal === '' ? null : parseInt(precioVal, 10),
      costo: costoVal === '' ? null : Math.max(0, parseInt(costoVal, 10)),
      garantia: $('fGarantia').value.trim(),
      etiqueta: $('fEtiqueta').value.trim(),
      descuento_porcentaje: descuentoVal === '' ? 0 : Math.max(0, Math.min(100, parseInt(descuentoVal, 10))),
      etiqueta_promo: $('fEtiquetaPromo').value.trim(),
      promo_inicio: $('fInicio').value || null,
      promo_fin: $('fFin').value || null,
      activo: $('fActivo').checked
    };

    /* Foto */
    let fotoUrl = editandoId ? ((admCuentas.find(x=>String(x.id)===editandoId)||{}).foto_url || '') : '';
    if(fotoPendiente){
      const urlNueva = await subirArchivo(fotoPendiente);
      if(fotoUrl) await quitarFotoDeUrl(fotoUrl);
      fotoUrl = urlNueva;
    }else if(editandoId && quitarFoto){
      if(fotoUrl) await quitarFotoDeUrl(fotoUrl);
      fotoUrl = '';
    }
    payload.foto_url = fotoUrl;

    let error = null;
    if(editandoId){
      ({ error } = await sb.from('productos').update(payload).eq('id', editandoId));
    }else{
      ({ error } = await sb.from('productos').insert([payload]));
    }
    if(error) throw error;

    toast(editandoId ? 'Producto actualizado' : 'Producto creado');
    cerrarForm();
    cargarCuentas();
  }catch(err){
    console.error(err);
    $('formMsg').textContent = (err && err.message) ? err.message : 'Ocurrió un error al guardar.';
  }finally{
    btn.disabled = false;
  }
}

/* ---------- Inicialización ---------- */
document.getElementById('loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  $('loginMsg').textContent = '';
  const btn = e.target.querySelector('button[type="submit"]');
  const email = $('admEmail').value.trim();
  const pass = $('admPass').value;
  if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Entrando…'; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if(error){
    $('loginMsg').textContent = 'Usuario o contraseña incorrectos.';
    toast('No se pudo iniciar sesión','error');
    if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión'; }
    return;
  }
  /* La sesión puede ser válida y aun así no ser admin: lo decide la RLS */
  accesoPermitido = await esAdmin();
  if(!accesoPermitido){
    avisoSinPermisos(email);
    try{ await sb.auth.signOut(); }catch(x){}
  }else{
    toast('¡Bienvenido! Sesión iniciada');
    mostrarDash();
  }
  if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión'; }
});

$('btnLogout').addEventListener('click', ()=>{
  accesoPermitido = false;
  setVista('productos');
  sb.auth.signOut();
});

$('btnNuevo').addEventListener('click', ()=> abrirForm());
$('productForm').addEventListener('submit', guardarCuenta);
$('admSearch').addEventListener('input', renderLista);
$('admFiltroCat').addEventListener('change', renderLista);

/* Navegación: productos / pedidos / ventas / publicidad / galería */
$('btnNavProductos').addEventListener('click', ()=> setVista('productos'));
$('btnNavPedidos').addEventListener('click', ()=> setVista('pedidos'));
$('btnNavVentas').addEventListener('click', ()=> setVista('ventas'));
$('btnNavBanners').addEventListener('click', ()=> setVista('banners'));
$('btnNavGaleria').addEventListener('click', ()=> setVista('galeria'));
$('btnNavContabilidad').addEventListener('click', ()=> setVista('contabilidad'));
$('solFiltroEstado').addEventListener('change', e=>{ solFiltro = e.target.value; renderPedidos(); });
$('solSearch').addEventListener('input', e=>{ solBusqueda = e.target.value.trim().toLowerCase(); renderPedidos(); });

/* Contabilidad */
$('contMes').addEventListener('change', e=>{ contMesActivo = e.target.value; renderContabilidad(); renderGastos(); });
$('btnNuevoGasto').addEventListener('click', abrirGastoForm);
$('gastoForm').addEventListener('submit', guardarGasto);
$('gCancelar').addEventListener('click', cerrarGastoForm);

/* Ventas */
$('ventaSearch').addEventListener('input', e=>{ ventaBusqueda = e.target.value.trim().toLowerCase(); renderVentas(); });
$('ventaFiltroEstado').addEventListener('change', e=>{ ventaFiltroEstado = e.target.value; renderVentas(); });
$('ventaFiltroMetodo').addEventListener('change', e=>{ ventaFiltroMetodo = e.target.value; renderVentas(); });

/* Foto: clic y arrastrar */
$('fotoDrop').addEventListener('click', ()=> $('fFoto').click());
$('fFoto').addEventListener('change', e=> prepararFoto(e.target.files[0]));
['dragover','dragenter'].forEach(evt=>{
  $('fotoDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); $('fotoDrop').classList.add('over'); });
});
['dragleave','drop'].forEach(evt=>{
  $('fotoDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); $('fotoDrop').classList.remove('over'); });
});
$('fotoDrop').addEventListener('drop', e=> prepararFoto(e.dataTransfer.files[0]));
$('btnQuitarFoto').addEventListener('click', ()=>{
  fotoPendiente = null;
  if(!editandoId){ quitarFoto = false; $('fotoPreviewWrap').classList.add('hidden'); $('fotoDrop').classList.remove('hidden'); return; }
  quitarFoto = true;
  $('fotoPreviewWrap').classList.add('hidden');
  $('fotoDrop').classList.remove('hidden');
});

/* Banner: clic y arrastrar */
$('btnNuevoBanner').addEventListener('click', ()=> abrirBannerForm());
$('bannerForm').addEventListener('submit', guardarBanner);
$('bfotoDrop').addEventListener('click', ()=> $('bfFoto').click());
$('bfFoto').addEventListener('change', e=> prepararBannerFoto(e.target.files[0]));
['dragover','dragenter'].forEach(evt=>{
  $('bfotoDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); $('bfotoDrop').classList.add('over'); });
});
['dragleave','drop'].forEach(evt=>{
  $('bfotoDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); $('bfotoDrop').classList.remove('over'); });
});
$('bfotoDrop').addEventListener('drop', e=> prepararBannerFoto(e.dataTransfer.files[0]));
$('btnQuitarBannerFoto').addEventListener('click', ()=>{
  bannerFotoPendiente = null;
  if(!editandoBannerId){ quitarBannerFoto = false; $('bfotoPreviewWrap').classList.add('hidden'); $('bfotoDrop').classList.remove('hidden'); return; }
  quitarBannerFoto = true;
  $('bfotoPreviewWrap').classList.add('hidden');
  $('bfotoDrop').classList.remove('hidden');
});

/* Galería de clientes felices: clic y arrastrar */
$('btnNuevaGaleria').addEventListener('click', ()=> abrirGaleriaForm());
$('galeriaForm').addEventListener('submit', guardarGaleria);
$('gfDrop').addEventListener('click', ()=> $('gfFoto').click());
$('gfFoto').addEventListener('change', e=> prepararGaleriaFoto(e.target.files[0]));
['dragover','dragenter'].forEach(evt=>{
  $('gfDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); $('gfDrop').classList.add('over'); });
});
['dragleave','drop'].forEach(evt=>{
  $('gfDrop').addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); $('gfDrop').classList.remove('over'); });
});
$('gfDrop').addEventListener('drop', e=> prepararGaleriaFoto(e.dataTransfer.files[0]));
$('btnQuitarGaleriaFoto').addEventListener('click', ()=>{
  galeriaFotoPendiente = null;
  if(editandoGaleriaId) quitarGaleriaFoto = true;
  $('gfPreviewWrap').classList.add('hidden');
  $('gfDrop').classList.remove('hidden');
  $('gfPreview').removeAttribute('src');
});

/* Cerrar modales con tecla Escape */
document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  cerrarForm();
  cerrarBannerForm();
  cerrarGaleriaForm();
  cerrarComprobante();
});

/* Arranque */
async function initAdmin(){
  try{
    sb = await clienteSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if(session) await entrarAlPanel(); else mostrarLogin();

    sb.auth.onAuthStateChange((evt, ses)=>{
      if(evt === 'SIGNED_OUT'){ accesoPermitido = false; mostrarLogin(); return; }
      if(ses) entrarAlPanel();
    });
  }catch(err){
    console.error(err);
    $('loginMsg').textContent = 'No se pudo conectar con Supabase. Revisa js/config.js';
  }
}
initAdmin();