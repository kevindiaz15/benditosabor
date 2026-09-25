# BENDITO SABOR

Tienda online de **pastelería** (tortas, postres, cupcakes, panadería y dulces). Catálogo dinámico sobre **Supabase**, panel administrador incluido y despliegue estático en **Vercel**.

El flujo de pedidos es por **WhatsApp**: el cliente arma su pedido, envía el formulario, adjunta el comprobante del pago y se confirma la entrega en la conversación. Cada pedido se guarda además en Supabase con un código de seguimiento (`BS-XXXXXX`).

## Estructura

```
index.html          Página pública (tienda online)
admin.html          Panel administrador (login + gestión de productos y pedidos)
css/style.css       Estilos de la tienda
css/extra.css       Fotos reales, promociones, stock y acceso admin
css/admin.css       Estilos del panel administrador
js/config.js        Configuración pública de Supabase (URL + publishable key)
js/store.js         Lógica de la tienda (lee productos de Supabase)
js/admin.js         Lógica del administrador (CRUD, subida de fotos, promos, pedidos)
supabase.sql        Script SQL de configuración (tablas, RLS, funciones y Storage)
img/                Recursos (logo)
```

## Funcionalidades

- **Catálogo dinámico:** los productos se cargan desde Supabase (tabla `productos`).
- **Categorías:** filtro por categoría (Tortas, Postres, Cupcakes, Panadería, Dulces).
- **Presentación:** cada producto se pide por presentación (Porción / Mediana / Grande).
- **Stock:** cada producto muestra cuántas unidades quedan; en 0 se marca **"Agotado"** y no se puede agregar al pedido.
- **Promociones:** descuento en %, etiqueta y fechas de vigencia por producto. Mientras la promo esté activa, la tienda muestra el precio final y el original tachado.
- **Información del encargo:** cada producto lleva su propio texto de encargo/anticipación, visible en el detalle.
- **Fotos reales:** se suben desde el admin a Supabase Storage. Si un producto no tiene foto, se muestra un placeholder con icono y gradiente.
- **Pedido:** persiste en `localStorage`, identifica cada línea por `id|presentación` y recalcula precios vivos desde la BD.
- **Pago y entrega:** el pedido construye un mensaje y lleva al cliente a WhatsApp. La entrega se coordina en la misma conversación **una vez confirmado el pago**. El cliente elige el método de pago (Nequi, Bancolombia, Daviplata, Efecty u Otro) y adjunta la **captura del comprobante**, que el admin revisa y confirma en el panel.
- **Métodos de pago:** sección "¿A dónde consignar?" en la tienda con los datos de cada método (Nequi, Bancolombia, Daviplata, Efecty). Son **datos genéricos** en `index.html`; reemplázalos por los reales cuando los tengas.
- **Carrusel de publicidad:** banners gestionados desde el panel (pestaña "Publicidad") que se muestran en la parte superior de la tienda con título, subtítulo, enlace opcional, orden y activo/oculto.
- **Código de seguimiento:** cada pedido recibe un código único (`BS-XXXXXX`). El cliente lo ve al enviar su pedido, se incluye en el mensaje de WhatsApp y puede **consultar el estado** desde la tienda (En revisión / Entregado / En garantía / Cerrada) sin exponer sus datos.
- **Torta personalizada:** sección destacada + asistente de 4 pasos (tamaño del 2 a 25 porciones → 9 sabores → diseño con imagen de referencia subida a Supabase → detalles y mensaje). Se guarda como encargo (`tipo = 'encargo'`) con su código de seguimiento y se envía por WhatsApp.
- **Clientes felices:** pestaña del panel que administra el carrusel de fotos de clientes (tabla `galeria`). Cada foto tiene título, texto, imagen, orden y activo/oculto; la tienda la muestra en la sección **Encargos** con flechas, puntos, avance automático, teclado (←/→) y gestos táctiles. Sin fotos activas, la sección muestra un aviso en lugar de un carrusel vacío.
- **Logo:** `img/logo.png` se usa en el navbar, footer, login del admin y favicon.
- **Stock automático:** al marcar un pedido como **Atendida**, el sistema descuenta el stock de cada producto vendido (una sola vez) y guarda el **costo** de lo vendido en ese momento (snapshot en `detalles.costo_total`).
- **Garantía:** nuevo estado del flujo (`nueva → vista → atendida → garantía → cerrada`). Al pasarlo a garantía se registra la fecha.
- **Ventas y garantías:** pestaña "Ventas" del panel con resumen (ventas cerradas, ingresos estimados, unidades vendidas, garantías activas) y el registro completo con "hace X días" desde el cierre para controlar las garantías.
- **Contabilidad:** pestaña del panel con utilidad mensual (Ingresos − Costo de ventas − Gastos), desglose por pedidos/encargos, margen y registro de **gastos** por categoría (insumos, mano de obra, empaques, servicios…). El costo de cada producto se captura en su formulario.
- **Correo masivo a clientes:** pestaña "Correos": lista de clientes únicos por correo (vista `clientes`, dedup de pedidos y encargos), selección múltiple y redactor con `{{nombre}}`, envía con **EmailJS** y guarda el historial de envíos (`envios`).
- **Admin:** botón de candado en el footer → `admin.html` → login con Supabase Auth (email + contraseña). Gestión de productos, pedidos (incl. encargos con "Cotizar valor"), ventas, banners, clientes felices, contabilidad y correos.

## Seguridad aplicada

- **RLS en todas las tablas.** El catálogo y la galería activa se leen sin sesión; `productos.costo` se le negate a `anon`; pedidos, gastos, correos y banners solo los lee y escribe un administrador.
- **Allowlist de administradores:** la tabla `public.admins` (email + nombre) y la función `public.es_admin()` deciden quién entra al panel. El login del admin verifica el rol y cierra la sesión si el usuario no está en la lista.
- **Escrituras sanitizadas en el servidor:** los clientes no pueden insertar pedidos ni encargos directamente; usan las funciones `security definer` `crear_pedido` y `crear_encargo`, que limpian textos, fijan `estado = 'nueva'`, ignoran precios ajenos y aceptan comprobantes solo del bucket correspondiente (`ruta_archivo_privada`).
- **Buckets privados:** `comprobantes` y `referencias` son privados. La tienda sube el archivo (con límite de tasa) y guarda solo la **ruta**; el panel la abre con una **URL firmada** de 1 hora, nunca una ruta pública.
- **Cierre de venta controlado:** `cerrar_venta` valida que quien llama sea admin, descuenta stock una sola vez y guarda el costo de lo vendido.
- **XSS:** todo el contenido de la base de datos se escapa antes de pintarse y las URLs de imagen se validan contra el dominio del proyecto.
- **Anti-abuso:** honeypot, enfriamiento de 60 s por navegador y límite de subidas anónimas en `solicitudes_anti_spam`.

## Configuración inicial (una sola vez)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Copia el contenido de `supabase.sql` y ejecútalo en **SQL Editor**. El script es re-ejecutable: puedes pegarlo de nuevo cuando quieras actualizar. Si `public.admins` está vacía, registra automáticamente al usuario más antiguo de Authentication.
3. En `js/config.js` verifica la **URL** y la **publishable key** de tu proyecto.
4. Crea tu usuario admin en **Authentication → Users → Add user** y luego ejecuta el paso 2 (o inserta tu correo en `public.admins`).
5. En **Authentication → Sign In / Providers**, desactiva el registro público por email: el panel solo debe abrirse con usuarios que tú creaste.
6. Cambia `WHATSAPP_NUMERO` en `js/store.js` por tu número real (solo dígitos, con clave de país).
7. *(Opcional, correo masivo)* Crea tu cuenta en [emailjs.com](https://www.emailjs.com), crea servicio + plantilla con las variables `to_email`, `to_name`, `subject` y `message`, y pega `public_key`, `service_id` y `template_id` en `js/config.js` (`EMAILJS_CONFIG`).
8. Sube los cambios a tu repo; Vercel despliega solo (proyecto estático).

> Si necesitas más de un administrador, inserta su correo en `public.admins`:
> `insert into public.admins (email) values ('tu@correo.com');`

## Pendientes de personalizar

- **WhatsApp:** reemplaza `WHATSAPP_NUMERO` en `js/store.js` (actualmente `573000000000`, un número de ejemplo).
- **Redes sociales:** los enlaces de WhatsApp, Instagram y TikTok están como `#` en `index.html` (navbar, sección contacto y footer). Pon los reales cuando los tengas.
- **Correo de contacto:** en `index.html` está `contacto@benditosabor.com` (placeholder).
- **EmailJS:** `js/config.js` trae marcadores `TU-EMAILJS-*`; sin ellos, el botón de envío masivo queda bloqueado. Configúralos en la pestaña "Correos" del admin.
- **Texto de garantía/condiciones:** redactado genérico en las secciones `#garantia` y `#condiciones` de `index.html`; ajústalo a tu política real.
- **Datos de consignación:** la sección "¿A dónde consignar?" (`#pagos` en `index.html`) trae datos genéricos para Nequi, Bancolombia, Daviplata y Efecty; reemplaza número/alias/titular por los reales.

## Modelo de datos (productos)

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid | PK |
| `nombre` | text | Obligatorio |
| `categoria` | text | tortas, postres, cupcakes, panaderia, dulces |
| `descripcion` | text | |
| `stock` | integer | Cantidad disponible; 0 o menos = Agotado, null = stock libre |
| `precio` | integer | null = "Consultar" |
| `costo` | integer | Costo de producción (para contabilidad) |
| `garantia` | text | Información del encargo / anticipación |
| `foto_url` | text | URL en Supabase Storage |
| `etiqueta` | text | Badge opcional (Nuevo, Más vendido…) |
| `orden` | integer | Orden de aparición |
| `activo` | boolean | Visible en tienda |
| `descuento_porcentaje` | numeric | 0–100 |
| `etiqueta_promo` | text | Badge de la promo |
| `promo_inicio` / `promo_fin` | date | Vigencia de la promo |
| `created_at` | timestamptz | |

## Otras tablas

| Tabla | Uso | Acceso |
| --- | --- | --- |
| `admins` | Allowlist de administradores (`es_admin()`) | Solo service role |
| `solicitudes` | Pedidos y encargos de la tienda | Lectura y escritura vía RPC sanitizadas |
| `gastos` | Gastos de contabilidad | Solo admin |
| `envios` | Historial de correos masivos | Solo admin |
| `banners` | Publicidad superior | Lectura pública de los activos |
| `galeria` | Fotos de clientes felices | Lectura pública de las activas |
| `clientes` (vista) | Emails únicos para el envío masivo | Solo admin |

## Buckets de Storage

| Bucket | Público | Quién escribe | Quién lee |
| --- | --- | --- | --- |
| `productos` | Sí | Admin | Todos |
| `banners` | Sí | Admin | Todos |
| `galeria` | Sí | Admin | Todos |
| `comprobantes` | **No** | Visitantes (con límite de tasa) | Admin (URL firmada) |
| `referencias` | **No** | Visitantes (con límite de tasa) | Admin (URL firmada) |#   b e n d i t o s a b o r  
 