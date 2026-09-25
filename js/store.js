/* =============================================================== */
/* BENDITO SABOR · Tienda (Supabase) · Pastelería                  */
/* Carga productos, banners, galería, precios, promos y stock.    */
/* Método de compra: pedido por WhatsApp + entrega coordinada.     */
/* =============================================================== */

let sb = null;
let cuentasDB = [];
let cuentasById = new Map();

/* 👉 Número de WhatsApp de la pastelería, con código de país (57 = Colombia)
   Formato: 57 + 10 dígitos, sin +, sin espacios.                            */
const WHATSAPP_NUMERO = '573132475495';

let carrito = cargarCarrito();
let filtroActivo = 'todos';
let busqueda = '';
let cuentaAbierta = null;

const ETIQUETAS_CAT = {
  tortas:'Tortas', postres:'Postres', cupcakes:'Cupcakes',
  panaderia:'Panadería', dulces:'Dulces'
};
const CAT_ICONOS = {
  tortas:'fa-cake-candles', postres:'fa-bowl-food', cupcakes:'fa-cookie-bite',
  panaderia:'fa-bread-slice', dulces:'fa-candy-cane'
};

/* Columnas públicas del catálogo: el `costo` nunca se expone. */
const COLS_PRODUCTO =
  'id,nombre,categoria,descripcion,stock,precio,garantia,foto_url,etiqueta,' +
  'orden,activo,descuento_porcentaje,etiqueta_promo,promo_inicio,promo_fin,created_at';

const formatCOP = n => n == null || n === '' || isNaN(Number(n)) ? 'Consultar' : '$' + Number(n).toLocaleString('es-CO');

/* =============================================================== */
/* SEGURIDAD · ESCAPADO Y EVENTOS DELEGADOS                       */
/* =============================================================== */
function esc_html(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Solo admite URLs http(s) o anclas internas (#seccion). */
function urlSegura(url){
  const s = String(url == null ? '' : url).trim();
  if(!s) return '';
  if(s.charAt(0) === '#') return /^#[A-Za-z0-9_-]+$/.test(s) ? s : '';
  if(/^https?:\/\//i.test(s)) return s;
  return '';
}

/* Para imágenes: exige http(s) o una ruta del propio proyecto. */
function urlImagen(url){
  const s = String(url == null ? '' : url).trim();
  if(!s) return '';
  if(/^(https?:)?\/\//i.test(s) || s.charAt(0) === '/') return s;
  return '';
}

/* Los atributos de evento se generan con datos codificados en base64url
   (alfabeto [A-Za-z0-9_-]), imposible que rompan el HTML. Se despachan con
   un único listener en lugar de inline onclick. */
const b64 = s => btoa(unescape(encodeURIComponent(String(s))))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = s => decodeURIComponent(escape(atob(
  String(s).replace(/-/g,'+').replace(/_/g,'/')
)));

function attrAct(fn, args){
  return 'data-act="' + esc_html(fn) + '" data-args="' + b64(JSON.stringify(args || [])) + '"';
}
function attrChg(fn, args){
  return 'data-chg="' + esc_html(fn) + '" data-args="' + b64(JSON.stringify(args || [])) + '"';
}
function decodArgs(el){
  try{
    const v = JSON.parse(unb64(el.dataset.args || ''));
    return Array.isArray(v) ? v : [v];
  }catch(e){ return []; }
}
function despacharAccion(e, attr){
  const el = e.target.closest('[' + attr + ']');
  if(!el) return;
  const fn = window[el.dataset[attr === 'data-act' ? 'act' : 'chg']];
  if(typeof fn !== 'function') return;
  e.preventDefault();
  try{ fn.apply(null, decodArgs(el).concat([el])); }
  catch(err){ console.error('Error en la acción ' + attr, err); }
}
document.addEventListener('click', e => despacharAccion(e, 'data-act'));
document.addEventListener('change', e => despacharAccion(e, 'data-chg'));

/* =============================================================== */
/* ENLACE DE WHATSAPP                                              */
/* =============================================================== */
function waEnlace(texto){
  const base = 'https://wa.me/' + WHATSAPP_NUMERO;
  return texto ? base + '?text=' + encodeURIComponent(texto) : base;
}

/* =============================================================== */
/* STOCK                                                           */
/* =============================================================== */
function stockValor(p){
  return (p.stock == null || p.stock === '') ? null : Number(p.stock);
}
function agotado(p){
  const s = stockValor(p);
  return s != null && s <= 0;
}

/* =============================================================== */
/* PROMOCIONES                                                     */
/* =============================================================== */
function fechaVigente(ini, fin){
  if(!ini || !fin) return false;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return hoy >= new Date(ini + 'T00:00:00') && hoy <= new Date(fin + 'T23:59:59');
}
function precioInfo(p){
  const base = (p.precio == null || p.precio === '') ? null : Number(p.precio);
  const pct = Number(p.descuento_porcentaje) || 0;
  const vigente = pct > 0 && fechaVigente(p.promo_inicio, p.promo_fin);
  const final = (base != null && vigente) ? Math.round(base * (1 - pct / 100)) : base;
  const etiqueta = vigente ? (p.etiqueta_promo || 'Oferta') : (p.etiqueta || '');
  return { base, pct, vigente, final, etiqueta };
}

/* =============================================================== */
/* SUPABASE                                                        */
/* =============================================================== */
function clienteSupabase(){
  return import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm')
    .then(m => m.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    }));
}
async function cargarCuentas(){
  const { data, error } = await sb
    .from('productos')
    .select(COLS_PRODUCTO)
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if(error) throw error;
  return data || [];
}

async function cargarBanners(){
  const { data, error } = await sb
    .from('banners')
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if(error) throw error;
  return data || [];
}

async function cargarGaleria(){
  const { data, error } = await sb
    .from('galeria')
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if(error) throw error;
  return data || [];
}

/* Guarda el pedido en Supabase.
   Devuelve { fila } si se guardo bien o { error } si fallo.
   IMPORTANTE: nunca se oculta el error. Un fallo silencioso hace creer al
   cliente que el pedido quedo registrado cuando en realidad no existe. */
async function registrarPedido(nombre, whatsapp, correo, detalles, mensaje_wa, metodo_pago, comprobante_path){
  if(!sb) return { error: new Error('sin-conexion') };
  try{
    const { data, error } = await sb.rpc('crear_pedido', {
      p_nombre: nombre,
      p_whatsapp: whatsapp,
      p_correo: correo,
      p_detalles: detalles,
      p_mensaje_wa: mensaje_wa,
      p_metodo_pago: metodo_pago || '',
      p_comprobante_url: comprobante_path || ''
    });
    if(error){ console.error('crear_pedido fallo:', error); return { error: error }; }
    if(!data) return { error: new Error('respuesta vacia') };
    return { fila: data };
  }catch(e){
    console.error('crear_pedido lanzo excepcion:', e);
    return { error: e };
  }
}

/* Convierte el error de Supabase en un texto util para el cliente. */
function explicarErrorPedido(err){
  const code = (err && (err.code || err.errorCode)) || '';
  const msg  = String((err && (err.message || err.details || err.hint)) || err || '');
  if(code === 'PGRST202' || /no se pudo encontrar la funci|function .* not found|schema cache/i.test(msg))
    return 'El servidor de pedidos esta desactualizado. El sitio necesita que se ejecute de nuevo supabase.sql.';
  if(code === '42501' || /row-level security|violates row level security|permission denied/i.test(msg))
    return 'Supabase rechazo el guardado por permisos. Ejecuta de nuevo supabase.sql en el SQL Editor.';
  if(/invalid regular expression|2201B/i.test(msg))
    return 'Hay un error en la base de datos (supabase.sql desactualizado). Ejecutalo de nuevo.';
  if(/demasiadas solicitudes/i.test(msg))
    return 'El filtro anti-spam detuvo el envio (demasiados pedidos seguidos). Espera unos minutos o escribenos por WhatsApp.';
  if(/demasiado larga/i.test(msg))
    return 'El pedido tiene demasiados productos. Envialo por WhatsApp para que lo armemos contigo.';
  if(/no v/i.test(msg))
    return 'El envio fue rechazado por la validacion del servidor. Revisa los datos o escribenos por WhatsApp.';
  return 'No pudimos guardar el pedido en la base de datos.';
}

/* =============================================================== */
/* BANNERS PUBLICITARIOS (carrusel)                                */
/* =============================================================== */
let bannersDB = [];
let indiceBanner = 0;
let timerBanner = null;

function renderBanners(){
  const track = document.getElementById('bannerTrack');
  const dots = document.getElementById('bannerDots');
  const seccion = document.getElementById('banners');
  const hero = seccion ? seccion.closest('.hero') : null;
  if(hero) hero.classList.toggle('no-banners', !bannersDB.length);
  if(!bannersDB.length){
    if(seccion) seccion.style.display = 'none';
    return;
  }
  if(seccion) seccion.style.display = '';
  indiceBanner = 0;
  track.innerHTML = bannersDB.map((b, i)=>{
    const img = urlImagen(b.imagen_url);
    const fondo = img
      ? 'background-image:url(&quot;' + esc_html(img) + '&quot;)'
      : 'background:linear-gradient(135deg,var(--naranja),var(--naranja-oscuro))';
    const enlace = urlSegura(b.enlace);
    let ext = '';
    if(enlace) ext = '<a class="banner-cta" href="' + esc_html(enlace) + '" target="_blank" rel="noopener noreferrer">Ver más <i class="fa-solid fa-arrow-right"></i></a>';
    return '<div class="banner-slide' + (i===0?' active':'') + '" style="' + fondo + '">'+
      '<div class="banner-sombra"></div>'+
      '<div class="banner-info">'+
        (b.titulo ? '<h3>' + esc_html(b.titulo) + '</h3>' : '')+
        (b.subtitulo ? '<p>' + esc_html(b.subtitulo) + '</p>' : '')+
        ext+
      '</div>'+
    '</div>';
  }).join('');
  dots.innerHTML = bannersDB.map((b,i)=>
    '<button class="banner-dot' + (i===0?' active':'') + '" ' + attrAct('irBanner', [i]) + ' aria-label="Banner '+(i+1)+'"></button>'
  ).join('');
  iniciarAutoBanner();
}

function moverBanner(d){
  if(!bannersDB.length) return;
  indiceBanner = (indiceBanner + d + bannersDB.length) % bannersDB.length;
  pintarBanner();
  reiniciarAutoBanner();
}
function irBanner(i, el){
  indiceBanner = Number(i) || 0;
  pintarBanner();
  reiniciarAutoBanner();
}
function pintarBanner(){
  const track = document.getElementById('bannerTrack');
  const dots = document.getElementById('bannerDots');
  if(!track) return;
  track.style.transform = 'translateX(-' + (indiceBanner * 100) + '%)';
  track.querySelectorAll('.banner-slide').forEach((el, i)=>el.classList.toggle('active', i===indiceBanner));
  if(dots) dots.querySelectorAll('.banner-dot').forEach((el, i)=>el.classList.toggle('active', i===indiceBanner));
}
function iniciarAutoBanner(){
  detenerAutoBanner();
  if(bannersDB.length < 2) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  timerBanner = setInterval(()=>moverBanner(1), 5000);
}
function detenerAutoBanner(){
  if(timerBanner){ clearInterval(timerBanner); timerBanner = null; }
}
function reiniciarAutoBanner(){
  detenerAutoBanner();
  iniciarAutoBanner();
}

/* =============================================================== */
/* GALERÍA · CLIENTES FELICES                                      */
/* =============================================================== */
let galeriaDB = [];
let galeriaFotos = [];
let indiceGaleria = 0;
let timerGaleria = null;

function renderGaleria(){
  const track = document.getElementById('galeriaTrack');
  const dots = document.getElementById('galeriaDots');
  const vacio = document.getElementById('galeriaEmpty');
  const sec = document.getElementById('galeria');
  if(!track) return;

  const fotos = galeriaDB.filter(g => urlImagen(g.imagen_url));
  if(!fotos.length){
    galeriaFotos = [];
    if(sec) sec.classList.add('sin-fotos');
    if(vacio) vacio.style.display = '';
    if(dots) dots.innerHTML = '';
    track.innerHTML = '';
    if(sec) sec.querySelectorAll('.gal-arrow').forEach(b => b.disabled = true);
    detenerAutoGaleria();
    return;
  }

  galeriaFotos = fotos;
  if(sec) sec.classList.remove('sin-fotos');
  if(vacio) vacio.style.display = 'none';
  if(sec) sec.querySelectorAll('.gal-arrow').forEach(b => b.disabled = false);

  indiceGaleria = 0;
  track.innerHTML = fotos.map((g, i)=>
    '<figure class="gal-slide' + (i===0?' active':'') + '">'+
      '<img src="' + esc_html(urlImagen(g.imagen_url)) + '" alt="' + esc_html(g.titulo || 'Trabajo de Bendito Sabor') + '" loading="lazy">'+
      '<figcaption>'+
        (g.titulo ? '<b>' + esc_html(g.titulo) + '</b>' : '')+
        (g.texto ? '<span>' + esc_html(g.texto) + '</span>' : '')+
      '</figcaption>'+
    '</figure>'
  ).join('');
  dots.innerHTML = fotos.map((g,i)=>
    '<button class="gal-dot' + (i===0?' active':'') + '" ' + attrAct('irGaleria', [i]) + ' aria-label="Foto '+(i+1)+'"></button>'
  ).join('');
  iniciarAutoGaleria();
}

function moverGaleria(d){
  if(galeriaFotos.length < 2) return;
  indiceGaleria = (indiceGaleria + d + galeriaFotos.length) % galeriaFotos.length;
  pintarGaleria();
  reiniciarAutoGaleria();
}
function irGaleria(i, el){
  const n = Number(i) || 0;
  if(galeriaFotos.length < 1) return;
  indiceGaleria = Math.max(0, Math.min(galeriaFotos.length - 1, n));
  pintarGaleria();
  reiniciarAutoGaleria();
}
function pintarGaleria(){
  const track = document.getElementById('galeriaTrack');
  const dots = document.getElementById('galeriaDots');
  if(!track) return;
  track.style.transform = 'translateX(-' + (indiceGaleria * 100) + '%)';
  track.querySelectorAll('.gal-slide').forEach((el, i)=>el.classList.toggle('active', i===indiceGaleria));
  if(dots) dots.querySelectorAll('.gal-dot').forEach((el, i)=>el.classList.toggle('active', i===indiceGaleria));
}
function iniciarAutoGaleria(){
  detenerAutoGaleria();
  if(galeriaFotos.length < 2) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  timerGaleria = setInterval(()=>moverGaleria(1), 6000);
}
function detenerAutoGaleria(){
  if(timerGaleria){ clearInterval(timerGaleria); timerGaleria = null; }
}
function reiniciarAutoGaleria(){
  detenerAutoGaleria();
  iniciarAutoGaleria();
}

/* Teclado y gestos táctiles sobre el carrusel */
(function(){
  const slider = document.getElementById('galeriaSlider');
  if(!slider) return;
  slider.addEventListener('keydown', e=>{
    if(e.key === 'ArrowLeft'){ e.preventDefault(); moverGaleria(-1); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); moverGaleria(1); }
  });
  slider.addEventListener('mouseenter', detenerAutoGaleria);
  slider.addEventListener('mouseleave', iniciarAutoGaleria);
  slider.addEventListener('focusin', detenerAutoGaleria);

  let x0 = null, y0 = null;
  slider.addEventListener('touchstart', e=>{
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY;
    detenerAutoGaleria();
  }, { passive: true });
  slider.addEventListener('touchend', e=>{
    if(x0 === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if(Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) moverGaleria(dx < 0 ? 1 : -1);
    else iniciarAutoGaleria();
  }, { passive: true });
})();

/* =============================================================== */
/* CATEGORÍAS                                                      */
/* =============================================================== */
function renderPlataformas(){
  const cats = [['tortas','Tortas'],['postres','Postres'],['cupcakes','Cupcakes'],['panaderia','Panadería'],['dulces','Dulces']];
  const grid = document.getElementById('catGrid');
  if(!grid) return;
  grid.innerHTML = cats.map(([clave,label])=>{
    const n = cuentasDB.filter(p=>p.activo && p.categoria===clave).length;
    return '<div class="cat-card" data-cat="'+clave+'" onclick="filtrarPorCategoria(\''+clave+'\')">'+
      '<div class="ico"><i class="fa-solid '+CAT_ICONOS[clave]+'"></i></div>'+
      '<h3>'+label+'</h3><small><b>'+n+'</b> producto'+(n===1?'':'s')+'</small></div>';
  }).join('');
}

/* =============================================================== */
/* CATÁLOGO                                                        */
/* =============================================================== */
function renderChips(){
  const chips = document.getElementById('chips');
  if(!chips) return;
  const opciones = [{k:'todos',v:'Todos'},...Object.entries(ETIQUETAS_CAT).map(([k,v])=>({k,v}))];
  chips.innerHTML = opciones.map(o=>
    '<button class="chip'+(filtroActivo===o.k?' active':'')+'" data-f="'+o.k+'" onclick="setFiltro(\''+o.k+'\')">'+o.v+'</button>'
  ).join('');
}

function cuentasFiltradas(){
  let lista = cuentasDB.filter(p=>p.activo);
  if(filtroActivo!=='todos') lista = lista.filter(p=>p.categoria===filtroActivo);
  if(busqueda){
    const q = busqueda.toLowerCase();
    lista = lista.filter(p=>
      (p.nombre||'').toLowerCase().includes(q) ||
      (p.descripcion||'').toLowerCase().includes(q) ||
      (ETIQUETAS_CAT[p.categoria]||'').toLowerCase().includes(q)
    );
  }
  return lista;
}

function infoTags(p){
  const info = precioInfo(p);
  let tags = '';
  if(info.vigente) tags += '<span class="tag promo">'+esc_html(info.etiqueta)+'</span>';
  else if(info.etiqueta) tags += '<span class="tag">'+esc_html(info.etiqueta)+'</span>';
  if(agotado(p)) tags += '<span class="tag soldout">Agotado</span>';
  else{
    const s = stockValor(p);
    if(s != null && s > 0 && s <= 5) tags += '<span class="tag stocktag">Quedan '+s+'</span>';
  }
  return tags ? '<div class="art-tags">'+tags+'</div>' : '';
}
function precioPillHTML(p){
  const info = precioInfo(p);
  if(info.base == null) return '<span class="price-pill"><span style="color:var(--naranja-oscuro)">Consultar</span></span>';
  if(info.vigente) return '<span class="price-pill promo"><span class="p-old">'+formatCOP(info.base)+'</span>'+formatCOP(info.final)+'</span>';
  return '<span class="price-pill">'+formatCOP(info.base)+'</span>';
}
function arteCuenta(p){
  const img = urlImagen(p.foto_url);
  let interior = '<div class="art-placeholder"><i class="fa-solid fa-cake-candles"></i></div>';
  if(img) interior = '<img class="art-img" src="'+esc_html(img)+'" alt="'+esc_html(p.nombre||'')+'" loading="lazy" onerror="this.remove()">';
  return '<div class="art">'+interior+infoTags(p)+precioPillHTML(p)+'</div>';
}

function renderCatalogo(){
  const grid = document.getElementById('productGrid');
  const vacio = document.getElementById('emptyState');
  if(!grid || !vacio) return;
  const lista = cuentasFiltradas();

  if(!lista.length){
    grid.innerHTML = '';
    if(!cuentasDB.length){
      vacio.querySelector('h3').textContent = 'Próximamente';
      vacio.querySelector('p').textContent = 'Estamos cargando nuestro catálogo de productos.';
    }else{
      vacio.querySelector('h3').textContent = 'No encontramos productos';
      vacio.querySelector('p').textContent = 'Intenta con otra palabra o pulsa el botón para ver todo el catálogo.';
    }
    vacio.classList.add('show');
    return;
  }
  vacio.classList.remove('show');
  grid.innerHTML = lista.map(p=>{
    const off = agotado(p);
    const cat = ETIQUETAS_CAT[p.categoria] || '';
    return '<article class="product-card reveal visible" data-id="'+esc_html(String(p.id))+'">'+
      arteCuenta(p) +
      '<div class="product-body">'+
        '<h3>'+esc_html(p.nombre)+'</h3>'+
        '<div class="aroma"><i class="fa-solid '+(CAT_ICONOS[p.categoria]||'fa-cake-candles')+'"></i>'+esc_html(cat)+'</div>'+
        '<p>'+esc_html(p.descripcion||'')+'</p>'+
        '<div class="meta"><i class="fa-solid fa-circle-info"></i>'+esc_html(p.garantia || 'Encargo por WhatsApp')+'</div>'+
        '<div class="product-actions">'+
          '<button class="btn-sm btn-details" '+attrAct('abrirCuenta', [String(p.id)])+'><i class="fa-solid fa-eye"></i> Detalles</button>'+
          (off
            ? '<button class="btn-sm btn-add off" disabled><i class="fa-solid fa-ban"></i> Agotado</button>'
            : '<button class="btn-sm btn-add" '+attrAct('agregarRapido', [String(p.id)])+'><i class="fa-solid fa-plus"></i> Agregar</button>')+
        '</div>'+
      '</div>'+
    '</article>';
  }).join('');
}

function setFiltro(k){
  filtroActivo = k;
  renderChips(); renderCatalogo();
  document.querySelectorAll('.cat-card').forEach(c=>c.classList.toggle('active', c.dataset.cat===k));
}
function filtrarPorCategoria(clave){
  setFiltro(clave);
  document.getElementById('catalogo').scrollIntoView({behavior:'smooth'});
}
function resetFilters(){
  filtroActivo = 'todos'; busqueda = '';
  const inp = document.getElementById('searchInput');
  if(inp) inp.value = '';
  renderChips(); renderCatalogo(); renderPlataformas();
}

/* Búsqueda con rebote para no redibujar el catálogo en cada tecla */
let timerBusqueda = null;
const elBusqueda = document.getElementById('searchInput');
if(elBusqueda){
  elBusqueda.addEventListener('input', e=>{
    const v = e.target.value.trim();
    if(timerBusqueda) clearTimeout(timerBusqueda);
    timerBusqueda = setTimeout(()=>{ busqueda = v; renderCatalogo(); }, 180);
  });
}

/* =============================================================== */
/* MODAL DETALLE DE PRODUCTO                                       */
/* =============================================================== */
function abrirCuenta(id){
  const p = cuentasById.get(String(id));
  if(!p) return;
  cuentaAbierta = p;
  const img = urlImagen(p.foto_url);
  document.getElementById('pmHead').innerHTML = img
    ? '<img src="'+esc_html(img)+'" alt="'+esc_html(p.nombre||'')+'">'
    : '<div class="pm-placeholder"><i class="fa-solid fa-cake-candles"></i></div>';

  const presentaciones = ['Porción','Mediana','Grande'];
  const ops = presentaciones.map(o=>'<option>'+o+'</option>').join('');
  const info = precioInfo(p);
  const prec = info.base == null
    ? '<span style="color:var(--naranja-oscuro)">Consultar</span>'
    : (info.vigente ? '<span class="p-old">'+formatCOP(info.base)+'</span>'+formatCOP(info.final) : formatCOP(info.base));
  const off = agotado(p);
  const stock = stockValor(p);
  const cat = ETIQUETAS_CAT[p.categoria] || '';
  const garantia = p.garantia || 'Encargo por WhatsApp';

  document.getElementById('pmBody').innerHTML =
    '<h3>'+esc_html(p.nombre)+'</h3>'+
    '<div class="pm-aroma"><i class="fa-solid '+(CAT_ICONOS[p.categoria]||'fa-cake-candles')+'"></i>Categoría: '+esc_html(cat)+'</div>'+
    '<div class="pm-price">'+prec+'</div>'+
    '<p class="pm-desc">'+esc_html(p.descripcion||'')+'</p>'+
    '<div class="pm-meta">'+
      '<span class="pill '+(off?'sold':'')+'"><i class="fa-solid fa-boxes-stacked"></i>'+(off?'Agotado':(stock==null?'Disponible':'Quedan '+stock))+'</span>'+
      '<span class="pill"><i class="fa-solid fa-clock-rotate-left"></i>'+esc_html(garantia)+'</span>'+
    '</div>'+
    '<div class="pm-garantia"><i class="fa-solid fa-circle-info"></i><span>'+esc_html(garantia)+'</span></div>'+
    '<div class="modal-field"><label for="pmPresent">Presentación</label>'+
    '<select id="pmPresent">'+ops+'</select></div>'+
    '<div class="qty-row"><span style="font-weight:600;font-size:.9rem;">Cantidad</span>'+
      '<div class="stepper">'+
        '<button class="step" onclick="cambiarCantModal(-1)"><i class="fa-solid fa-minus"></i></button>'+
        '<span class="n" id="pmQty">1</span>'+
        '<button class="step" onclick="cambiarCantModal(1)"><i class="fa-solid fa-plus"></i></button>'+
      '</div></div>'+
    '<div class="pm-total"><div><small>Subtotal</small><br><b id="pmSubtotal"></b></div>'+
    '<i class="fa-solid fa-cake-candles" style="color:var(--naranja);font-size:1.4rem;"></i></div>'+
    (off
      ? '<button class="btn btn-primary btn-block" disabled><i class="fa-solid fa-ban"></i> Agotado</button>'
      : '<button class="btn btn-primary btn-block" onclick="agregarDesdeModal()"><i class="fa-solid fa-bag-shopping"></i> Agregar al pedido</button>');

  actualizarSubtotalModal();
  document.getElementById('productModal').classList.add('open');
  document.body.style.overflow='hidden';
}

function subtotalFinalDeCuenta(){
  const p = cuentaAbierta;
  const c = parseInt(document.getElementById('pmQty').textContent)||1;
  const info = precioInfo(p);
  return { c, info };
}
function actualizarSubtotalModal(){
  const { c, info } = subtotalFinalDeCuenta();
  document.getElementById('pmSubtotal').textContent = info.base == null ? 'Consultar' : formatCOP(info.final * c);
  return c;
}
function cambiarCantModal(d){
  const el = document.getElementById('pmQty');
  if(!el) return;
  let n = (parseInt(el.textContent)||1)+d;
  const max = cuentaAbierta ? (stockValor(cuentaAbierta) || 99) : 99;
  if(n < 1) n = 1;
  if(n > max) n = max;
  el.textContent = n;
  actualizarSubtotalModal();
}
function agregarDesdeModal(){
  const p = cuentaAbierta;
  if(!p) return;
  const c = actualizarSubtotalModal();
  const presentacion = document.getElementById('pmPresent').value;
  agregarCuenta(p.id, c, presentacion);
  toast('agregado a tu pedido','success',p.nombre);
  cerrarCuenta();
}
function agregarRapido(id, btn){
  const p = cuentasById.get(String(id));
  if(!p) return;
  if(agotado(p)){ toast('está agotado actualmente','warn',p.nombre); return; }
  const card = btn && btn.closest ? btn.closest('.product-card') : null;
  if(card){ card.classList.remove('adding'); void card.offsetWidth; card.classList.add('adding'); }
  agregarCuenta(p.id, 1, 'Porción');
  toast('agregado a tu pedido','success',p.nombre);
}
function cerrarCuenta(){
  document.getElementById('productModal').classList.remove('open');
  if(!document.getElementById('orderModal').classList.contains('open') &&
     !document.getElementById('cartDrawer').classList.contains('open')) document.body.style.overflow='';
}

/* =============================================================== */
/* CARRITO Y PEDIDO                                                */
/* =============================================================== */
function cargarCarrito(){
  try{
    const raw = localStorage.getItem('benditosabor_pedido');
    const lista = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(lista)) return [];
    return lista
      .filter(l => l && typeof l === 'object' && l.id != null)
      .map(l => ({
        clave: String(l.id) + '|' + String(l.presentacion || 'Porción'),
        id: String(l.id),
        name: String(l.name == null ? '' : l.name),
        price: (l.price == null || l.price === '') ? null : Number(l.price) || 0,
        descuento_porcentaje: Number(l.descuento_porcentaje) || 0,
        promo_inicio: l.promo_inicio || null,
        promo_fin: l.promo_fin || null,
        etiqueta_promo: String(l.etiqueta_promo || ''),
        categoria: String(l.categoria || ''),
        foto_url: urlImagen(l.foto_url),
        presentacion: String(l.presentacion || 'Porción'),
        qty: Math.max(1, parseInt(l.qty, 10) || 1)
      }));
  }catch(e){ return []; }
}
function guardarCarrito(){
  try{ localStorage.setItem('benditosabor_pedido', JSON.stringify(carrito)); }
  catch(e){ console.warn('No se pudo guardar el carrito', e); }
  renderCart(); actualizarBadges();
}

function agregarCuenta(id, cantidad, presentacion){
  const p = cuentasById.get(String(id));
  if(!p) return;
  if(agotado(p)){ toast('está agotado actualmente','warn',p.nombre); return; }

  const clave = String(id) + '|' + (presentacion || 'Porción');
  const existente = carrito.find(l=>l.clave===clave);
  const pedida = (existente ? existente.qty : 0) + cantidad;
  const disponible = stockValor(p);
  let final = cantidad;
  if(disponible != null && pedida > disponible){
    final = Math.max(0, disponible - (existente ? existente.qty : 0));
    if(final <= 0){
      toast('ya tienes todas las unidades disponibles en tu pedido','warn',p.nombre);
      return;
    }
    toast('solo quedan ' + disponible + ' unidades disponibles','warn',p.nombre);
  }

  const linea = {
    clave, id:String(id),
    name:p.nombre, price:(p.precio==null||p.precio==='') ? null : Number(p.precio),
    descuento_porcentaje:Number(p.descuento_porcentaje)||0,
    promo_inicio:p.promo_inicio||null, promo_fin:p.promo_fin||null,
    etiqueta_promo:p.etiqueta_promo||'',
    categoria:(ETIQUETAS_CAT[p.categoria]||p.categoria||''), foto_url:urlImagen(p.foto_url),
    presentacion, qty:final
  };
  if(existente) existente.qty += final;
  else carrito.push(linea);
  guardarCarrito();
}
function cambiarCantidad(clave, delta){
  const l = carrito.find(x=>x.clave===clave);
  if(!l) return;
  const p = cuentasById.get(String(l.id));
  const disponible = p ? stockValor(p) : null;
  let n = l.qty + delta;
  if(n < 1) n = 1;
  if(disponible != null && n > disponible){
    n = disponible;
    toast('no hay más unidades disponibles de ese producto','warn',p ? p.nombre : l.name);
  }
  l.qty = n;
  guardarCarrito();
}
function eliminarItem(clave, el){
  const l = carrito.find(x=>x.clave===clave);
  carrito = carrito.filter(x=>x.clave!==clave);
  guardarCarrito();
  toast('eliminado del pedido','warn',l ? l.name : '');
}
function contarItems(){
  return carrito.reduce((a,l)=>a+l.qty,0);
}
function comprimirCarrito(){
  const out = [];
  carrito.forEach(l=>{
    const e = out.find(x=>x.clave===l.clave);
    if(e) e.qty += l.qty; else out.push(Object.assign({}, l));
  });
  return out;
}
function infoViva(linea){
  const viva = cuentasById.get(String(linea.id));
  if(viva) return viva;
  return linea;
}
function subtotalLinea(linea){
  const info = precioInfo(infoViva(linea));
  return info.final == null ? null : info.final * linea.qty;
}

function renderCart(){
  const body = document.getElementById('drawerBody');
  const foot = document.getElementById('drawerFoot');
  if(!body || !foot) return;
  if(!carrito.length){
    body.innerHTML = '<div class="cart-empty"><i class="fa-solid fa-cake-candles"></i><h4 style="margin-bottom:.4rem;">Tu pedido está vacío</h4><p style="font-size:.85rem;">Explora el catálogo y agrega los productos que más se te antojen.</p></div>';
    foot.innerHTML = '<button class="btn btn-primary btn-block" onclick="cerrarPedido();document.getElementById(\'catalogo\').scrollIntoView({behavior:\'smooth\'})"><i class="fa-solid fa-cake-candles"></i> Ver catálogo</button>';
    return;
  }

  const items = carrito.map(l=>{
    const p = infoViva(l);
    const info = precioInfo(p);
    const foto = urlImagen(p.foto_url) || urlImagen(l.foto_url);
    const thumb = foto
      ? '<img src="'+esc_html(foto)+'" alt="'+esc_html(p.nombre||l.name)+'" loading="lazy">'
      : '<i class="fa-solid fa-cake-candles"></i>';
    const precioStr = info.base == null ? 'Consultar' : (info.vigente ? '<span class="p-old">'+formatCOP(info.base)+'</span>'+formatCOP(info.final) : formatCOP(info.base));
    const sub = info.final == null ? '' : '<span class="sub">'+formatCOP(info.final * l.qty)+'</span>';
    return '<div class="cart-item">'+
      '<div class="thumb">'+thumb+'</div>'+
      '<div class="info">'+
        '<div class="nm">'+esc_html(p.nombre||l.name)+'</div>'+
        '<div class="pr">'+precioStr+' · '+esc_html(l.categoria||'')+'</div>'+
        '<div class="present">'+esc_html(l.presentacion)+'</div>'+
        '<div class="line">'+
          '<div class="mini-step">'+
            '<button '+attrAct('cambiarCantidad',[l.clave,-1])+' aria-label="Restar"><i class="fa-solid fa-minus"></i></button>'+
            '<span class="qn">'+l.qty+'</span>'+
            '<button '+attrAct('cambiarCantidad',[l.clave,1])+' aria-label="Sumar"><i class="fa-solid fa-plus"></i></button>'+
          '</div>'+sub+
          '<button class="remove" '+attrAct('eliminarItem',[l.clave])+' title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>'+
        '</div>'+
      '</div></div>';
  }).join('');

  const subtotales = carrito.map(subtotalLinea).filter(x=>x!=null);
  const sub = subtotales.reduce((a,x)=>a+x,0);
  const hayConsultar = carrito.some(l=>precioInfo(infoViva(l)).final == null);

  body.innerHTML = items;
  foot.innerHTML =
    '<div class="row"><span>Subtotal</span><span>'+formatCOP(sub)+'</span></div>'+
    (hayConsultar?'<div class="row" style="color:var(--naranja-oscuro);font-style:italic;"><span>Productos especiales</span><span>Consultar</span></div>':'')+
    '<div class="row total"><span>Total estimado</span><b>'+(hayConsultar ? formatCOP(sub)+' + consulta' : formatCOP(sub))+'</b></div>'+
    '<div class="note"><i class="fa-solid fa-circle-info"></i><span>El pedido se confirma por WhatsApp y la entrega se coordina contigo.</span></div>'+
    '<button class="btn btn-primary btn-block" onclick="abrirSolicitudPedido()"><i class="fa-solid fa-paper-plane"></i> Solicitar pedido</button>';
}

function actualizarBadges(pop){
  const n = contarItems();
  const badge = document.getElementById('cartBadge');
  const fbadge = document.getElementById('fBadge');
  if(badge) badge.textContent = n;
  if(fbadge) fbadge.textContent = n;
  if(badge) badge.classList.toggle('show', n>0);
  if(fbadge) fbadge.style.display = n>0?'':'none';
  if(pop && badge){
    badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop');
  }
}

/* Drawer */
function abrirPedido(e){
  if(e) e.preventDefault();
  renderCart();
  document.getElementById('cartDrawer').classList.add('open');
  document.body.style.overflow='hidden';
}
function cerrarPedido(){
  document.getElementById('cartDrawer').classList.remove('open');
  if(!document.getElementById('productModal').classList.contains('open') &&
     !document.getElementById('orderModal').classList.contains('open')) document.body.style.overflow='';
}
function toggleMenu(){
  document.getElementById('hamburger').classList.toggle('open');
  document.getElementById('navLinks').classList.toggle('open');
}
document.getElementById('navLinks').addEventListener('click', e=>{
  if(e.target.closest('a')){
    document.getElementById('hamburger').classList.remove('open');
    document.getElementById('navLinks').classList.remove('open');
  }
});

/* =============================================================== */
/* SOLICITAR PEDIDO (formulario)                                   */
/* =============================================================== */
function abrirSolicitudPedido(){
  if(!carrito.length){
    toast('Tu pedido está vacío. Agrega algunos productos primero','warn');
    return;
  }
  cerrarPedido();
  document.getElementById('orderForm').reset();
  document.getElementById('orderForm')._abierto = Date.now();
  document.getElementById('orderSuccess').classList.remove('show');
  document.getElementById('orderFormView').style.display='';
  document.querySelectorAll('.field .msg').forEach(m=>m.classList.remove('show'));
  document.querySelectorAll('.field input,.field select,.field textarea').forEach(el=>el.classList.remove('err'));
  limpiarComprobanteUI(true);

  /* Reinicia el botón de WhatsApp: si no, apuntaría al pedido anterior */
  const wa = document.getElementById('waOrderBtn');
  if(wa) wa.href = waEnlace('');
  const oc = document.getElementById('orderCode');
  if(oc) oc.style.display = 'none';

  const comp = comprimirCarrito();
  const subtotales = comp.map(subtotalLinea).filter(x=>x!=null);
  const sub = subtotales.reduce((a,x)=>a+x,0);
  const hayConsultar = comp.some(l=>precioInfo(infoViva(l)).final == null);
  const lineas = comp.map(l=>'<div class="rl"><span>'+esc_html(l.name)+' × '+l.qty+'</span><span>'+(subtotalLinea(l)==null?'Consultar':formatCOP(subtotalLinea(l)))+'</span></div>').join('');
  document.getElementById('orderResume').innerHTML =
    '<h4><i class="fa-solid fa-bag-shopping"></i> Resumen de tu pedido</h4>'+lineas+
    '<div class="rl total"><span>Total estimado</span><b>'+(hayConsultar?'Consultar':formatCOP(sub))+'</b></div>';

  document.getElementById('orderModal').classList.add('open');
  document.body.style.overflow='hidden';
}
function cerrarPedidoModal(){
  document.getElementById('orderModal').classList.remove('open');
  if(!document.getElementById('productModal').classList.contains('open') &&
     !document.getElementById('cartDrawer').classList.contains('open')) document.body.style.overflow='';
}

/* Validación simple */
function campoError(id, cond){
  const el = document.getElementById(id);
  if(!el) return true;
  const msg = el.parentElement ? el.parentElement.querySelector('.msg') : null;
  const bad = !cond;
  el.classList.toggle('err', bad);
  if(msg) msg.classList.toggle('show', bad);
  return bad;
}
function validarEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v||'').trim()); }

/* =============================================================== */
/* COMPROBANTE DE PAGO                                             */
/* =============================================================== */
const MIME_OK = ['image/jpeg','image/png','image/webp'];
const MAX_MB = 5;
let comprobanteFile = null;

function limpiarComprobanteUI(resetSel){
  comprobanteFile = null;
  if(resetSel){
    const sel = document.getElementById('oMetodoPago');
    if(sel) sel.value = '';
  }
  const file = document.getElementById('capFile');
  if(file) file.value = '';
  const prev = document.getElementById('capPreviewWrap');
  const drop = document.getElementById('capDrop');
  if(prev){ prev.classList.add('hidden'); prev.querySelector('img').removeAttribute('src'); }
  if(drop) drop.classList.remove('hidden');
}

function prepararComprobante(file){
  if(!file) return;
  if(MIME_OK.indexOf(file.type) < 0){
    toast('El comprobante debe ser una imagen JPG, PNG o WebP','warn');
    return;
  }
  if(file.size > MAX_MB * 1024 * 1024){
    toast('El comprobante supera los ' + MAX_MB + ' MB','warn');
    return;
  }
  comprobanteFile = file;
  document.getElementById('capPreview').src = URL.createObjectURL(file);
  document.getElementById('capPreviewWrap').classList.remove('hidden');
  document.getElementById('capDrop').classList.add('hidden');
}

/* Nombre no adivinable + extensión real. Devuelve la RUTA del archivo
   (el bucket comprobantes es privado: el admin lo abre con URL firmada). */
function nombreArchivo(prefijo, file){
  let rnd;
  try{ rnd = crypto.randomUUID(); }
  catch(e){ rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
  const ext = MIME_OK.indexOf(file.type) >= 0 ? ('.' + file.type.split('/')[1].replace('jpeg','jpg')) : '.bin';
  return prefijo + '/' + rnd + ext;
}
async function subirArchivoPrivado(file, bucket, prefijo){
  const path = nombreArchivo(prefijo, file);
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type });
  if(error) throw error;
  return path;
}

const capDrop = document.getElementById('capDrop');
if(capDrop){
  capDrop.addEventListener('click', ()=> document.getElementById('capFile').click());
  document.getElementById('capFile').addEventListener('change', e=> prepararComprobante(e.target.files[0]));
  ['dragover','dragenter'].forEach(evt=>{
    capDrop.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); capDrop.classList.add('over'); });
  });
  ['dragleave','drop'].forEach(evt=>{
    capDrop.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); capDrop.classList.remove('over'); });
  });
  capDrop.addEventListener('drop', e=> prepararComprobante(e.dataTransfer.files[0]));
  document.getElementById('capQuitar').addEventListener('click', e=>{ e.stopPropagation(); limpiarComprobanteUI(false); });
}

/* =============================================================== */
/* ANTI-SPAM (cliente)                                             */
/* =============================================================== */
function claveAnti(tipo){ return 'benditosabor_anti_' + tipo; }
function marcarAnti(tipo){ try{ localStorage.setItem(claveAnti(tipo), String(Date.now())); }catch(e){} }
function antiRepite(tipo){
  const last = parseInt(localStorage.getItem(claveAnti(tipo)) || '0', 10);
  return (Date.now() - last) < 60000;
}
function esBot(form){
  const hp = form.querySelector('.hp-field');
  if(hp && hp.value.trim() !== '') return true;
  const desde = form._abierto || 0;
  return !!(desde && (Date.now() - desde) < 3000);
}

document.getElementById('orderForm').addEventListener('submit', async function(e){
  e.preventDefault();
  let ok = true;
  ok = !campoError('oNombre', document.getElementById('oNombre').value.trim().length >= 2) && ok;
  ok = !campoError('oWhats', /^[0-9]{7,12}$/.test((document.getElementById('oWhats').value||'').replace(/[^0-9]/g,''))) && ok;
  ok = !campoError('oCorreo', validarEmail(document.getElementById('oCorreo').value)) && ok;
  const metodo = document.getElementById('oMetodoPago').value;
  ok = !campoError('oMetodoPago', metodo !== '') && ok;
  const capMsg = document.querySelector('.comprobante-zone + .msg');
  if(!comprobanteFile){
    ok = false;
    if(capMsg) capMsg.classList.add('show');
  }else if(capMsg){
    capMsg.classList.remove('show');
  }
  if(!ok){ toast('Revisa los campos marcados','warn'); return; }

  /* Honeypot: nunca se muestra una pantalla de éxito falsa */
  if(esBot(this)){ toast('No pudimos registrar la solicitud. Intenta de nuevo en un momento.','warn'); return; }
  if(antiRepite('pedido')){ toast('Ya enviaste un pedido hace menos de un minuto. Te contactaremos pronto.','warn'); return; }

  const nombre = document.getElementById('oNombre').value.trim();
  const comp = comprimirCarrito();
  const subtotales = comp.map(subtotalLinea).filter(x=>x!=null);
  const sub = subtotales.reduce((a,x)=>a+x,0);
  const hayConsultar = comp.some(l=>precioInfo(infoViva(l)).final == null);

  let prod = '';
  comp.forEach(l=>{ prod += '\n* ' + l.name + ' (' + l.presentacion + ') x' + l.qty + (subtotalLinea(l)==null ? ' (Consultar)' : ' ' + formatCOP(subtotalLinea(l))); });

  let msg = 'Hola, Bendito Sabor.\n\nQuiero realizar un pedido.\n\nNombre: '+nombre+'\nMétodo de pago: '+metodo+'\nProductos:'+prod+
    '\n\nTotal estimado: '+(hayConsultar?'Consultar':formatCOP(sub))+
    '\n\nAdjunto el comprobante de mi pago para tu confirmación y la coordinación de la entrega. Gracias.';

  const btn = this.querySelector('button[type="submit"]');
  if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…'; }

  let codigo = '';
  let aviso = '';
  let falloGuardado = '';
  try{
    let comprobante_path = '';
    if(comprobanteFile){
      try{ comprobante_path = await subirArchivoPrivado(comprobanteFile, 'comprobantes', 'comprobantes'); }
      catch(err){ console.warn('No se pudo subir el comprobante', err); aviso = 'No pudimos adjuntar tu comprobante; envíalo por WhatsApp.'; }
    }

    const res = await registrarPedido(
      nombre,
      (document.getElementById('oWhats').value||'').trim(),
      (document.getElementById('oCorreo').value||'').trim(),
      {
        items: comp.map(l=>({ id: String(l.id), nombre: l.name, presentacion: l.presentacion||'', categoria: l.categoria||'', cantidad: l.qty, subtotal: subtotalLinea(l) })),
        total: hayConsultar ? null : sub
      },
      msg,
      metodo,
      comprobante_path
    );
    if(res.error){
      falloGuardado = explicarErrorPedido(res.error);
    }else{
      if(res.fila && res.fila.codigo) codigo = res.fila.codigo;
      else falloGuardado = 'El servidor no devolvio el numero de seguimiento.';
    }
  }catch(err){
    console.error('Error enviando el pedido', err);
    falloGuardado = explicarErrorPedido(err);
  }

  /* El pedido NUNCA se pierde: aunque la base de datos falle, el cliente
     siempre puede enviar su mensaje por WhatsApp. Pero si no se guardo, se
     dice con claridad: nunca se muestra "exito" cuando no se registro nada. */
  let msgWA = msg;
  if(codigo) msgWA += '\n\nNo. de seguimiento: ' + codigo + ' (guárdalo para consultar tu pedido)';
  const wa = document.getElementById('waOrderBtn');
  if(wa) wa.href = waEnlace(msgWA);

  const oc = document.getElementById('orderCode');
  if(oc && codigo){
    oc.style.display = '';
    oc.querySelector('b').textContent = codigo;
  }else if(oc){
    oc.style.display = 'none';
  }

  document.getElementById('orderFormView').style.display='none';
  document.getElementById('orderSuccess').classList.add('show');
  carrito = [];
  guardarCarrito();
  /* Solo se marca el anti-repetición si el pedido REALMENTE se guardó.
     Si falló, el cliente debe poder reintentar sin ver "ya enviaste un pedido". */
  if(!falloGuardado) marcarAnti('pedido');
  if(falloGuardado){
    toast(falloGuardado + (aviso ? ' ' + aviso : '') + ' Envíalo por WhatsApp para no perderlo.', 'warn', '', 9000);
  }else if(aviso){
    toast(aviso, 'warn', '', 7000);
  }else{
    toast('¡Pedido recibido con éxito!', 'success');
  }
  if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar solicitud'; }
});

/* =============================================================== */
/* TORTA PERSONALIZADA (wizard 4 pasos)                            */
/* =============================================================== */
const CAKE_TAMAGOS = [
  { num: '2',    etq: '2 porciones' },
  { num: '4-6',  etq: 'de 4 a 6 porciones' },
  { num: '8-10', etq: 'de 8 a 10 porciones' },
  { num: '12-15',etq: 'de 12 a 15 porciones' },
  { num: '16-20',etq: 'de 16 a 20 porciones' },
  { num: '25',   etq: '25 porciones' }
];
const CAKE_SABORES = [
  'Vainilla tradicional','Naranja con amapola','Banano con arequipe','Chocolate',
  'Red Velvet','Zanahoria con amapola','Yogurt','Café con Baileys','Maracuyá'
];

let cakeEstado = {
  paso: 1, tam: '', sabor: '', deco: '', ocasion: '', fecha: '',
  mensaje: '', nombre: '', whats: '', correo: '',
  referenciaFile: null, referenciaUrl: ''
};

const val = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

function pintarCakeOpciones(){
  const tamGrid = document.getElementById('cakeTamGrid');
  const sabGrid = document.getElementById('cakeSaborGrid');
  if(tamGrid && !tamGrid.hasChildNodes()){
    CAKE_TAMAGOS.forEach(o=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cake-opt';
      b.dataset.v = o.etq;
      b.innerHTML = '<b>'+o.num+'</b><span>porciones</span>';
      b.addEventListener('click', ()=>seleccionarCakeOpt(b, 'tam'));
      tamGrid.appendChild(b);
    });
  }
  if(sabGrid && !sabGrid.hasChildNodes()){
    CAKE_SABORES.forEach(s=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cake-opt';
      b.dataset.v = s;
      b.textContent = s;
      b.addEventListener('click', ()=>seleccionarCakeOpt(b, 'sabor'));
      sabGrid.appendChild(b);
    });
  }
}

function seleccionarCakeOpt(b, campo){
  b.parentElement.querySelectorAll('.cake-opt').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  cakeEstado[campo] = b.dataset.v;
  b.parentElement.classList.remove('cake-alert');
}

function limpiarErroresCake(){
  document.querySelectorAll('#cakeModal .field .msg').forEach(m=>m.classList.remove('show'));
  document.querySelectorAll('#cakeModal .field input,#cakeModal .field textarea').forEach(el=>el.classList.remove('err'));
  document.querySelectorAll('#cakeModal .cake-grid').forEach(g=>g.classList.remove('cake-alert'));
}

function resaltar(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.classList.add('err');
  const msg = el.parentElement ? el.parentElement.querySelector('.msg') : null;
  if(msg) msg.classList.add('show');
}
function resaltarGrid(id){
  const g = document.getElementById(id);
  if(g) g.classList.add('cake-alert');
}

/* Cada paso exige sus datos antes de dejar avanzar */
function cakePasoValido(paso){
  if(paso === 1 && !cakeEstado.tam){
    resaltarGrid('cakeTamGrid');
    toast('Escoge el tamaño de tu torta para continuar','warn');
    return false;
  }
  if(paso === 2 && !cakeEstado.sabor){
    resaltarGrid('cakeSaborGrid');
    toast('Escoge tu sabor favorito para continuar','warn');
    return false;
  }
  if(paso === 3){
    const deco = val('cDecoracion');
    cakeEstado.deco = deco;
    if(!deco && !cakeEstado.referenciaFile){
      resaltar('cDecoracion');
      toast('Describe la decoración o sube una imagen de referencia','warn');
      return false;
    }
    campoError('cDecoracion', deco.length >= 3);
  }
  return true;
}

function moverPaso(n){
  const destino = Math.max(1, Math.min(4, n));
  if(destino > cakeEstado.paso && !cakePasoValido(cakeEstado.paso)) return;
  cakeEstado.paso = destino;
  for(let i = 1; i <= 4; i++){
    const panel = document.getElementById('cPanel'+i);
    const step  = document.getElementById('cStep'+i);
    if(panel) panel.classList.toggle('active', i === destino);
    if(step)  step.classList.toggle('active',  i === destino);
  }
  document.getElementById('cakeProgressBar').style.width = (destino * 25) + '%';
  document.getElementById('cBack').style.visibility = destino === 1 ? 'hidden' : 'visible';
  document.getElementById('cNext').classList.toggle('hidden', destino === 4);
  document.getElementById('cSubmit').classList.toggle('hidden', destino !== 4);
}
function cakePaso(delta){ moverPaso(cakeEstado.paso + delta); }

function abrirPersonalizada(){
  cakeEstado = {
    paso: 1, tam: '', sabor: '', deco: '', ocasion: '', fecha: '',
    mensaje: '', nombre: '', whats: '', correo: '',
    referenciaFile: null, referenciaUrl: ''
  };
  ['cNombre','cWhats','cCorreo','cOcasion','cFecha','cDecoracion','cMensaje'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  limpiarErroresCake();
  limpiarRefUI(true);
  pintarCakeOpciones();
  document.querySelectorAll('.cake-opt').forEach(x=>x.classList.remove('sel'));
  const succ = document.getElementById('cakeSuccess');
  succ.style.display = 'none';
  document.getElementById('cakeHead').style.display = '';
  document.getElementById('cakeBodyWrap').style.display = '';
  document.getElementById('cakeFoot').style.display = '';
  const cd = document.getElementById('cakeCode');
  if(cd) cd.style.display = 'none';
  const wa = document.getElementById('waEncargoBtn');
  if(wa) wa.href = waEnlace('');
  moverPaso(1);
  document.getElementById('cakeModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarPersonalizada(){
  document.getElementById('cakeModal').classList.remove('open');
  if(!document.getElementById('productModal').classList.contains('open') &&
     !document.getElementById('cartDrawer').classList.contains('open') &&
     !document.getElementById('orderModal').classList.contains('open')) document.body.style.overflow = '';
}

/* Imagen de referencia */
function prepararRef(file){
  if(!file) return;
  if(MIME_OK.indexOf(file.type) < 0){
    toast('La imagen de referencia debe ser JPG, PNG o WebP','warn');
    return;
  }
  if(file.size > MAX_MB * 1024 * 1024){
    toast('La imagen supera los ' + MAX_MB + ' MB','warn');
    return;
  }
  cakeEstado.referenciaFile = file;
  document.getElementById('refPreview').src = URL.createObjectURL(file);
  document.getElementById('refPreviewWrap').classList.remove('hidden');
  document.getElementById('refDrop').classList.add('hidden');
}
function limpiarRefUI(resetInput){
  cakeEstado.referenciaFile = null;
  const file = document.getElementById('refFile');
  if(file) file.value = '';
  const prev = document.getElementById('refPreviewWrap');
  const drop = document.getElementById('refDrop');
  if(prev){ prev.classList.add('hidden'); const img = prev.querySelector('img'); if(img) img.removeAttribute('src'); }
  if(drop) drop.classList.remove('hidden');
  if(resetInput) cakeEstado.referenciaUrl = '';
}

const refDrop = document.getElementById('refDrop');
if(refDrop){
  refDrop.addEventListener('click', ()=> document.getElementById('refFile').click());
  document.getElementById('refFile').addEventListener('change', e=> prepararRef(e.target.files[0]));
  ['dragover','dragenter'].forEach(evt=>{
    refDrop.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); refDrop.classList.add('over'); });
  });
  ['dragleave','drop'].forEach(evt=>{
    refDrop.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); refDrop.classList.remove('over'); });
  });
  refDrop.addEventListener('drop', e=> prepararRef(e.dataTransfer.files[0]));
  document.getElementById('refQuitar').addEventListener('click', e=>{ e.stopPropagation(); limpiarRefUI(false); });
}

/* Guarda el encargo en Supabase (tipo='encargo').
   Devuelve { fila } o { error }; nunca oculta el fallo. */
async function registrarEncargo(nombre, whatsapp, correo, detalles, mensaje_wa, referencia_path){
  if(!sb) return { error: new Error('sin-conexion') };
  try{
    const { data, error } = await sb.rpc('crear_encargo', {
      p_nombre: nombre,
      p_whatsapp: whatsapp,
      p_correo: correo,
      p_detalles: detalles,
      p_mensaje_wa: mensaje_wa,
      p_comprobante_url: referencia_path || ''
    });
    if(error){ console.error('crear_encargo fallo:', error); return { error: error }; }
    if(!data) return { error: new Error('respuesta vacia') };
    return { fila: data };
  }catch(e){
    console.error('crear_encargo lanzo excepcion:', e);
    return { error: e };
  }
}

async function enviarEncargo(btn){
  if(btn.disabled) return;
  limpiarErroresCake();

  cakeEstado.ocasion = val('cOcasion');
  cakeEstado.fecha    = val('cFecha');
  cakeEstado.deco     = val('cDecoracion');
  cakeEstado.mensaje  = val('cMensaje');
  cakeEstado.nombre   = val('cNombre');
  cakeEstado.whats    = val('cWhats');
  cakeEstado.correo   = val('cCorreo');

  let ok = true;
  ok = !campoError('cDecoracion', cakeEstado.deco.length >= 3 || !!cakeEstado.referenciaFile) && ok;
  ok = !campoError('cMensaje', cakeEstado.mensaje.length >= 10) && ok;
  ok = !campoError('cNombre', cakeEstado.nombre.length >= 2) && ok;
  ok = !campoError('cWhats', /^[0-9]{7,12}$/.test(cakeEstado.whats.replace(/[^0-9]/g, ''))) && ok;
  ok = !campoError('cCorreo', validarEmail(cakeEstado.correo)) && ok;
  if(!ok){
    toast('Revisa los campos marcados: todos son obligatorios','warn');
    return;
  }
  if(antiRepite('encargo')){ toast('Ya enviaste un encargo hace menos de un minuto. Te contactaremos pronto.','warn'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…';

  let referenciaPath = '';
  let codigo = '';
  let aviso = '';
  let falloGuardado = '';
  try{
    if(cakeEstado.referenciaFile){
      try{ referenciaPath = await subirArchivoPrivado(cakeEstado.referenciaFile, 'referencias', 'referencias'); }
      catch(err){ console.warn('No se pudo subir la referencia', err); aviso = 'No pudimos subir tu imagen de referencia; envíala por WhatsApp.'; }
    }
    cakeEstado.referenciaUrl = referenciaPath;

    const detalles = {
      tipo: 'torta_personalizada',
      tamano: cakeEstado.tam,
      sabor: cakeEstado.sabor,
      ocasion: cakeEstado.ocasion,
      fecha: cakeEstado.fecha,
      decoracion: cakeEstado.deco,
      mensaje: cakeEstado.mensaje,
      referencia_url: referenciaPath,
      total: null
    };

    let fechaLegible = '';
    if(cakeEstado.fecha){
      const partes = cakeEstado.fecha.split('-');
      if(partes.length === 3) fechaLegible = partes[2] + '/' + partes[1] + '/' + partes[0];
    }

    const msg = 'Hola, Bendito Sabor.\n\nQuiero pedir una TORTA PERSONALIZADA.\n\n* Tamaño: ' + cakeEstado.tam +
      '\n* Sabor: ' + cakeEstado.sabor +
      '\n* Ocasión: ' + (cakeEstado.ocasion || '—') +
      '\n* Fecha del evento: ' + (fechaLegible || '—') +
      '\n* Decoración: ' + (cakeEstado.deco || '—') +
      '\n* Detalles: ' + cakeEstado.mensaje +
      (referenciaPath ? '\n* Adjunto una imagen de referencia (queda guardada en el sistema, la veré al contactarme).' : '') +
      '\n\nNombre: ' + cakeEstado.nombre +
      '\nCorreo: ' + cakeEstado.correo +
      '\n\nMe contactan por WhatsApp para confirmar precio, disponibilidad y fecha de entrega. ¡Gracias!';

    const resE = await registrarEncargo(
      cakeEstado.nombre,
      cakeEstado.whats.replace(/[^0-9]/g, ''),
      cakeEstado.correo,
      detalles,
      msg,
      referenciaPath
    );
    if(resE.error) falloGuardado = explicarErrorPedido(resE.error);
    else if(resE.fila && resE.fila.codigo) codigo = resE.fila.codigo;
    else falloGuardado = 'El servidor no devolvio el numero de seguimiento.';

    const wa = document.getElementById('waEncargoBtn');
    if(wa) wa.href = waEnlace(msg + (codigo ? '\n\nNo. de seguimiento: ' + codigo + ' (guárdalo para consultar tu encargo)' : ''));

    const oc = document.getElementById('cakeCode');
    if(oc){
      if(codigo){
        oc.style.display = '';
        const b = oc.querySelector('b');
        if(b) b.textContent = codigo;
      }else{
        oc.style.display = 'none';
      }
    }

    document.getElementById('cakeSuccess').style.display = 'flex';
    document.getElementById('cakeHead').style.display = 'none';
    document.getElementById('cakeBodyWrap').style.display = 'none';
    document.getElementById('cakeFoot').style.display = 'none';
    if(!falloGuardado) marcarAnti('encargo');
    if(falloGuardado){
      toast(falloGuardado + (aviso ? ' ' + aviso : '') + ' Envíalo por WhatsApp para no perderlo.', 'warn', '', 9000);
    }else if(aviso){
      toast(aviso, 'warn', '', 7000);
    }else{
      toast('¡Encargo enviado con éxito!', 'success');
    }
  }catch(err){
    console.error('Error enviando el encargo', err);
    toast('Ocurrió un problema. Revisa los datos e intenta de nuevo.','warn');
  }finally{
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar por WhatsApp';
  }
}

/* =============================================================== */
/* TOASTS                                                          */
/* =============================================================== */
/* `mensaje` siempre se escapa. `nombre` se pinta en negrita, también escapado. */
function toast(mensaje, tipo, nombre, ms){
  const cont = document.getElementById('toastWrap');
  if(!cont) return;
  const ico = tipo === 'warn' ? 'fa-triangle-exclamation' : tipo === 'success' ? 'fa-circle-check' : 'fa-cake-candles';
  const t = document.createElement('div');
  t.className = 'toast ' + (tipo || '');
  t.setAttribute('role', 'status');
  t.innerHTML = '<i class="fa-solid ' + ico + ' ic"></i><span>' +
    (nombre ? '<strong>' + esc_html(nombre) + '</strong> ' : '') +
    esc_html(mensaje) + '</span>';
  cont.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{
    t.classList.remove('show');
    setTimeout(()=>t.remove(), 500);
  }, typeof ms === 'number' ? ms : 3200);
}

/* =============================================================== */
/* REVEAL AL SCROLL + ESC                                           */
/* =============================================================== */
if('IntersectionObserver' in window){
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(en=>{
      if(en.isIntersecting){
        en.target.classList.add('visible');
        io.unobserve(en.target);
      }
    });
  },{threshold:.12});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
}

document.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    cerrarCuenta(); cerrarPedido(); cerrarPedidoModal(); cerrarPersonalizada();
    const hb = document.getElementById('hamburger');
    const nl = document.getElementById('navLinks');
    if(hb) hb.classList.remove('open');
    if(nl) nl.classList.remove('open');
  }
});

/* =============================================================== */
/* CONSULTA DE ESTADO POR CÓDIGO                                  */
/* =============================================================== */
const ESTADO_COMPRA = {
  nueva:'En revisión', vista:'En revisión', atendida:'Entregado',
  garantia:'En garantía', cerrada:'Cerrada'
};

function fechaCorta(f){
  const d = new Date(f);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'});
}

async function consultarPedido(){
  const inp = document.getElementById('consCodigo');
  if(!inp) return;
  const codigo = (inp.value||'').trim().toUpperCase();
  const res = document.getElementById('consResult');
  if(!codigo){ toast('Ingresa tu código de pedido (BS-XXXXXX)','warn'); if(res) res.innerHTML=''; return; }
  if(!sb){ if(res) res.innerHTML = '<div class="cons-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.</p></div>'; return; }
  if(res) res.innerHTML = '<div class="cons-loading"><i class="fa-solid fa-spinner fa-spin"></i> Consultando tu pedido…</div>';
  try{
    const { data, error } = await sb.rpc('consultar_pedido', { p_codigo: codigo });
    if(error) throw error;
    if(!data || !data.length){
      if(res) res.innerHTML = '<div class="cons-empty"><i class="fa-solid fa-circle-question"></i><p>No encontramos un pedido con ese código.<br>Verifica que esté bien escrito e inténtalo de nuevo.</p></div>';
      return;
    }
    const p = data[0];
    const label = ESTADO_COMPRA[p.estado] || p.estado || '';
    const art = p.estado==='garantia' ? '<i class="fa-solid fa-shield-halved"></i>' :
                p.estado==='atendida' ? '<i class="fa-solid fa-circle-check"></i>' :
                p.estado==='cerrada' ? '<i class="fa-solid fa-lock"></i>' :
                '<i class="fa-regular fa-clock"></i>';
    const items = (Array.isArray(p.items)?p.items:[]).map(it=>
      '<div class="rl"><span>' + esc_html(it.nombre||'') +
      (it.presentacion ? ' <em>· ' + esc_html(it.presentacion) + '</em>' : '') +
      ' × ' + esc_html(String(it.cantidad == null ? 1 : it.cantidad)) +
      '</span><span>' + (it.subtotal == null ? 'Consultar' : formatCOP(it.subtotal)) + '</span></div>'
    ).join('');
    const resumen = items
      ? '<div class="cons-items"><h4><i class="fa-solid fa-bag-shopping"></i> Tu pedido</h4>' + items +
        (p.total != null ? '<div class="rl total"><span>Total</span><b>' + formatCOP(p.total) + '</b></div>' : '') + '</div>'
      : '';
    if(res) res.innerHTML =
      '<div class="cons-card">'+
        '<div class="cons-head">'+
          '<div><small>Código</small><b>'+esc_html(p.codigo)+'</b></div>'+
          '<span class="cons-pill '+esc_html(p.estado)+'">'+art+' '+esc_html(label)+'</span>'+
        '</div>'+
        '<div class="cons-meta">'+
          '<span><i class="fa-regular fa-calendar"></i> Solicitud: '+esc_html(fechaCorta(p.creado))+'</span>'+
          (p.fecha_cierre ? '<span><i class="fa-solid fa-circle-check"></i> Entregado: '+esc_html(fechaCorta(p.fecha_cierre))+'</span>' : '')+
          (p.fecha_garantia ? '<span><i class="fa-solid fa-shield-halved"></i> Garantía desde: '+esc_html(fechaCorta(p.fecha_garantia))+'</span>' : '')+
          (p.metodo_pago ? '<span><i class="fa-solid fa-wallet"></i> '+esc_html(p.metodo_pago)+'</span>' : '')+
        '</div>'+
        resumen+
      '</div>';
  }catch(err){
    console.error('Error consultando pedido', err);
    if(res) res.innerHTML = '<div class="cons-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Ocurrió un error al consultar. Intenta de nuevo en unos segundos.</p></div>';
  }
}

/* =============================================================== */
/* INICIALIZACIÓN                                                   */
/* =============================================================== */
let sincronizando = false;
async function sincronizarCatalogo(silencioso){
  const modal = document.getElementById('orderModal');
  if(modal && modal.classList.contains('open')) return;
  if(sincronizando) return;               /* evita doble fetch simultáneo */
  if(!sb) return;
  sincronizando = true;
  try{
    cuentasDB = await cargarCuentas();
    cuentasById = new Map(cuentasDB.map(p=>[String(p.id), p]));
    renderPlataformas();
    renderChips();
    renderCatalogo();
    renderCart();
    actualizarBadges();
  }catch(err){
    console.warn('No se pudo re-sincronizar el catálogo', err);
    if(!silencioso) throw err;
  }finally{
    sincronizando = false;
  }
}

async function init(){
  try{
    sb = await clienteSupabase();
  }catch(err){
    console.error('No se pudo cargar Supabase', err);
    mostrarErrorCatalogo('No pudimos cargar el catálogo', 'Revisa tu conexión o intenta de nuevo en unos segundos.');
    return;
  }

  document.getElementById('orderForm')._abierto = Date.now();
  try{
    await sincronizarCatalogo(false);
  }catch(err){
    console.error('Error cargando catálogo', err);
    mostrarErrorCatalogo('No pudimos cargar el catálogo', 'Revisa tu conexión o intenta de nuevo en unos segundos.');
  }

  try{
    bannersDB = await cargarBanners();
    renderBanners();
  }catch(err){
    console.warn('Error cargando banners', err);
    const seccion = document.getElementById('banners');
    const hero = seccion && seccion.closest('.hero');
    if(hero) hero.classList.add('no-banners');
    if(seccion) seccion.style.display = 'none';
  }

  try{
    galeriaDB = await cargarGaleria();
    renderGaleria();
  }catch(err){
    console.warn('Error cargando la galería', err);
    renderGaleria();
  }
}

function mostrarErrorCatalogo(titulo, texto){
  const vacio = document.getElementById('emptyState');
  if(!vacio) return;
  vacio.querySelector('h3').textContent = titulo;
  vacio.querySelector('p').textContent = texto;
  const btn = vacio.querySelector('button');
  if(btn){
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reintentar';
    btn.onclick = ()=>{ location.reload(); };
  }
  vacio.classList.add('show');
}

init();

/* Re-sincroniza el catálogo (stock y promos) cuando vuelves a la pestaña */
let ultimoSync = 0;
function refrescarSiHaceFalta(){
  if(Date.now() - ultimoSync < 30000) return;
  ultimoSync = Date.now();
  sincronizarCatalogo(true);
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') refrescarSiHaceFalta();
});
window.addEventListener('focus', refrescarSiHaceFalta);
