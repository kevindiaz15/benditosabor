-- ================================================================
-- BENDITO SABOR · Configuración de Supabase (Pastelería)
-- Pega este script completo en: Dashboard → SQL Editor → New query → Run
-- Es RE-EJECUTABLE (no da error si ya lo correste antes).
-- ================================================================
-- IMPORTANTE
--   1) Este script SOLO crea permisos para correos registrados en la
--      tabla `public.admins`. Al final hace un bootstrap automático con
--      el usuario más antiguo de Authentication. Si todavía no tienes
--      usuarios, crea el tuyo y vuelve a ejecutar este script.
--   2) Desactiva el registro público por correo en
--      Authentication → Sign In / Providers → Email → "Enable email
--      signup" = OFF. Así nadie más puede crear una cuenta con
--      permisos de administrador.
-- ================================================================

-- ---------------------------------------------------------------
-- 0) EXTENSIONES
-- ---------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- 1) LISTA DE ADMINISTRADORES (control real de acceso)
--    Antes, cualquier usuario autenticado podía modificarlo todo.
--    Ahora solo los correos de esta tabla tienen permisos.
-- ---------------------------------------------------------------
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Comprueba si el usuario de la sesión actual es administrador.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.es_admin() from public;
grant execute on function public.es_admin() to anon, authenticated;

-- Solo los propios administradores pueden ver la lista de correos.
drop policy if exists "admins_lectura" on public.admins;
create policy "admins_lectura"
  on public.admins for select
  using (public.es_admin());

-- ---------------------------------------------------------------
-- 1.5) AYUDANTES DE VALIDACIÓN
--     Sin expresiones regulares a propósito: un patrón mal formado
--     aborta TODOS los pedidos con el error 2201B
--     ("invalid regular expression: invalid repetition count(s)").
--     Se definen aquí porque los usan functions de secciones posteriores.
-- ---------------------------------------------------------------
-- es_entero('12000', 12) -> true      es_entero('12a', 12) -> false
create or replace function public.es_entero(p_txt text, p_max integer default 12)
returns boolean
language sql
immutable
as $$
  select coalesce(p_txt, '') <> ''
     and translate(p_txt, '0123456789', '') = ''
     and length(p_txt) between 1 and greatest(1, coalesce(p_max, 12));
$$;

-- es_uuid('3f0d9a6e-1c2b-4d5e-8f90-a1b2c3d4e5f6') -> true
create or replace function public.es_uuid(p_txt text)
returns boolean
language sql
immutable
as $$
  select length(p_txt) = 36
     and translate(p_txt, '0123456789abcdefABCDEF-', '') = ''
     and length(translate(p_txt, '-', '')) = 32
     and substr(p_txt,  9, 1) = '-'
     and substr(p_txt, 14, 1) = '-'
     and substr(p_txt, 19, 1) = '-'
     and substr(p_txt, 24, 1) = '-';
$$;

-- solo_digitos('+57 (300) 123-4567') -> '573001234567'
create or replace function public.solo_digitos(p_txt text)
returns text
language sql
immutable
as $$
  select coalesce((
    select string_agg(c, '')
      from unnest(string_to_array(coalesce(p_txt, ''), '')) as c
     where c in ('0','1','2','3','4','5','6','7','8','9')
  ), '');
$$;

-- ---------------------------------------------------------------
-- 2) PRODUCTOS (catálogo de la pastelería)
-- ---------------------------------------------------------------
create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null default 'tortas',
  descripcion text default '',
  stock integer default 1,
  precio integer,
  costo integer,
  garantia text default '',
  foto_url text default '',
  etiqueta text default '',
  orden integer default 0,
  activo boolean default true,
  descuento_porcentaje numeric default 0,
  etiqueta_promo text default '',
  promo_inicio date,
  promo_fin date,
  created_at timestamptz default now()
);

alter table public.productos add column if not exists costo integer;

create index if not exists productos_orden_idx on public.productos (orden, created_at);

-- Integridad de los importes (se omiten los CHECK si ya hay datos sucios)
do $$
begin
  alter table public.productos
    add constraint productos_precio_check check (precio is null or precio >= 0);
exception when others then
  raise notice 'BENDITO SABOR: no se aplicó productos_precio_check (hay precios negativos).';
end $$;
do $$
begin
  alter table public.productos
    add constraint productos_costo_check check (costo is null or costo >= 0);
exception when others then
  raise notice 'BENDITO SABOR: no se aplicó productos_costo_check (hay costos negativos).';
end $$;
do $$
begin
  alter table public.productos
    add constraint productos_stock_check check (stock is null or stock >= 0);
exception when others then
  raise notice 'BENDITO SABOR: no se aplicó productos_stock_check (hay stock negativo).';
end $$;
do $$
begin
  alter table public.productos
    add constraint productos_descuento_check
      check (descuento_porcentaje is null or (descuento_porcentaje >= 0 and descuento_porcentaje <= 100));
exception when others then
  raise notice 'BENDITO SABOR: no se aplicó productos_descuento_check (descuentos fuera de 0-100).';
end $$;

-- Seguridad
alter table public.productos enable row level security;

-- El público solo ve los productos activos (los borrados/ocultos no se filtran).
drop policy if exists "productos_lectura_publica" on public.productos;
create policy "productos_lectura_publica"
  on public.productos for select
  using (activo is true);

-- El admin ve absolutamente todo, activos y ocultos.
drop policy if exists "productos_admin_select" on public.productos;
create policy "productos_admin_select"
  on public.productos for select
  using (public.es_admin());

drop policy if exists "productos_admin_insert" on public.productos;
create policy "productos_admin_insert"
  on public.productos for insert
  with check (public.es_admin());

drop policy if exists "productos_admin_update" on public.productos;
create policy "productos_admin_update"
  on public.productos for update
  using (public.es_admin())
  with check (public.es_admin());

drop policy if exists "productos_admin_delete" on public.productos;
create policy "productos_admin_delete"
  on public.productos for delete
  using (public.es_admin());

-- El costo de producción es secreto comercial: el público NO lo lee.
-- Por eso la tienda selecciona columnas explícitas (nunca `select *`).
revoke select on public.productos from anon;
grant select (
  id, nombre, categoria, descripcion, stock, precio, garantia, foto_url,
  etiqueta, orden, activo, descuento_porcentaje, etiqueta_promo,
  promo_inicio, promo_fin, created_at
) on public.productos to anon;
grant select on public.productos to authenticated;

-- ---------------------------------------------------------------
-- 3) STORAGE · FOTOS DE PRODUCTOS (bucket público, escribe el admin)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "storage_productos_lectura" on storage.objects;
create policy "storage_productos_lectura"
  on storage.objects for select
  using (bucket_id = 'productos');

drop policy if exists "storage_productos_insert" on storage.objects;
create policy "storage_productos_insert"
  on storage.objects for insert
  with check (bucket_id = 'productos' and public.es_admin());

drop policy if exists "storage_productos_update" on storage.objects;
create policy "storage_productos_update"
  on storage.objects for update
  using (bucket_id = 'productos' and public.es_admin());

drop policy if exists "storage_productos_delete" on storage.objects;
create policy "storage_productos_delete"
  on storage.objects for delete
  using (bucket_id = 'productos' and public.es_admin());

-- ---------------------------------------------------------------
-- 4) PEDIDOS Y ENCARGOS (solicitudes recibidas desde la tienda)
-- ---------------------------------------------------------------
create table if not exists public.solicitudes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  nombre text not null,
  whatsapp text default '',
  correo text default '',
  detalles jsonb default '{}'::jsonb,
  mensaje_wa text default '',
  metodo_pago text default '',
  comprobante_url text default '',
  codigo text,
  stock_descontado boolean not null default false,
  fecha_cierre timestamptz,
  fecha_garantia timestamptz,
  estado text default 'nueva',
  created_at timestamptz default now()
);

alter table public.solicitudes add column if not exists metodo_pago text default '';
alter table public.solicitudes add column if not exists comprobante_url text default '';
alter table public.solicitudes add column if not exists codigo text;
alter table public.solicitudes add column if not exists stock_descontado boolean not null default false;
alter table public.solicitudes add column if not exists fecha_cierre timestamptz;
alter table public.solicitudes add column if not exists fecha_garantia timestamptz;

do $$
begin
  alter table public.solicitudes
    add constraint solicitudes_tipo_check check (tipo in ('pedido','encargo'));
exception when others then
  raise notice 'BENDITO SABOR: no se aplicó solicitudes_tipo_check.';
end $$;
do $$
begin
  alter table public.solicitudes
    add constraint solicitudes_estado_check
      check (estado in ('nueva','vista','atendida','garantia','cerrada'));
exception when others then
  raise notice 'BENDITO SABOR: no se aplicó solicitudes_estado_check.';
end $$;

create unique index if not exists solicitudes_codigo_uidx on public.solicitudes (codigo) where codigo is not null;
create index if not exists solicitudes_idx on public.solicitudes (estado, created_at desc);
create index if not exists solicitudes_metodo_idx on public.solicitudes (metodo_pago);
create index if not exists solicitudes_cierre_idx on public.solicitudes (fecha_cierre desc);

alter table public.solicitudes enable row level security;

-- IMPORTANTE: ya NO existe una política de INSERT pública.
-- Las solicitudes entran únicamente por las funciones crear_pedido() y
-- crear_encargo(), que limpian y validan los datos en el servidor. Así es
-- imposible que alguien falsifique el total, el estado o el descuento de
-- stock desde fuera.
drop policy if exists "solicitudes_insert_publico" on public.solicitudes;

drop policy if exists "solicitudes_admin_select" on public.solicitudes;
create policy "solicitudes_admin_select"
  on public.solicitudes for select
  using (public.es_admin());

drop policy if exists "solicitudes_admin_update" on public.solicitudes;
create policy "solicitudes_admin_update"
  on public.solicitudes for update
  using (public.es_admin())
  with check (public.es_admin());

drop policy if exists "solicitudes_admin_delete" on public.solicitudes;
create policy "solicitudes_admin_delete"
  on public.solicitudes for delete
  using (public.es_admin());

-- ---------------------------------------------------------------
-- 5) ANTI-SPAM (a nivel de base de datos)
-- ---------------------------------------------------------------
create or replace function public.solicitudes_anti_spam()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy integer;
begin
  -- Toda solicitud real de la tienda genera su mensaje de WhatsApp
  if new.mensaje_wa is null or length(trim(new.mensaje_wa)) < 20 then
    raise exception 'Solicitud no válida';
  end if;
  if length(new.mensaje_wa) > 8000 then
    raise exception 'Solicitud demasiado larga';
  end if;

  -- Nombre mínimo, sin HTML ni URLs
  if new.nombre is null or length(trim(new.nombre)) < 2 then
    raise exception 'Nombre no válido';
  end if;
  if length(new.nombre) > 120 then
    raise exception 'Nombre demasiado largo';
  end if;
  if position('<' in new.nombre) > 0 or position('>' in new.nombre) > 0
     or position('http' in lower(new.nombre)) > 0 then
    raise exception 'Nombre no válido';
  end if;

  -- Límite por remitente: 5 solicitudes en la última hora
  select count(*) into v_hoy
  from public.solicitudes
  where created_at > now() - interval '1 hour'
    and lower(coalesce(correo,'')) = lower(coalesce(new.correo,''))
    and coalesce(whatsapp,'') = coalesce(new.whatsapp,'');
  if v_hoy >= 5 then
    raise exception 'Demasiadas solicitudes en poco tiempo';
  end if;

  -- Tope global: evita que un bot bloquee el canal de ventas
  select count(*) into v_hoy
  from public.solicitudes
  where created_at > now() - interval '1 hour';
  if v_hoy >= 60 then
    raise exception 'Demasiadas solicitudes en poco tiempo';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_solicitudes_anti_spam on public.solicitudes;
create trigger trg_solicitudes_anti_spam
  before insert on public.solicitudes
  for each row execute function public.solicitudes_anti_spam();

-- ---------------------------------------------------------------
-- 5.5) CÓDIGO DE SEGUIMIENTO (BS-XXXXXX)
-- ---------------------------------------------------------------
create or replace function public.solicitudes_generar_codigo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare c text;
begin
  if new.codigo is null or trim(new.codigo) = '' then
    loop
      c := 'BS-' || lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
      exit when not exists (select 1 from public.solicitudes where codigo = c);
    end loop;
    new.codigo := c;
  else
    new.codigo := upper(trim(new.codigo));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_solicitudes_codigo on public.solicitudes;
create trigger trg_solicitudes_codigo
  before insert on public.solicitudes
  for each row execute function public.solicitudes_generar_codigo();

-- ---------------------------------------------------------------
-- 6) CONTABILIDAD · GASTOS OPERATIVOS
-- ---------------------------------------------------------------
create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  concepto text not null,
  categoria text not null default 'Insumos',
  valor integer not null default 0 check (valor >= 0),
  descripcion text default '',
  fecha date not null default current_date,
  created_at timestamptz default now()
);

create index if not exists gastos_fecha_idx on public.gastos (fecha desc);

alter table public.gastos enable row level security;

drop policy if exists "gastos_admin_select" on public.gastos;
create policy "gastos_admin_select"
  on public.gastos for select
  using (public.es_admin());

drop policy if exists "gastos_admin_insert" on public.gastos;
create policy "gastos_admin_insert"
  on public.gastos for insert
  with check (public.es_admin());

drop policy if exists "gastos_admin_update" on public.gastos;
create policy "gastos_admin_update"
  on public.gastos for update
  using (public.es_admin())
  with check (public.es_admin());

drop policy if exists "gastos_admin_delete" on public.gastos;
create policy "gastos_admin_delete"
  on public.gastos for delete
  using (public.es_admin());

-- ---------------------------------------------------------------
-- 7) CORREO MASIVO (retirado)
--    La funcionalidad se eliminó del panel. Estas sentencias borran
--    lo que quedara de versiones anteriores, para que reejecutar
--    este script también limpie la base de datos.
--    Van dentro de un bloque con manejador de error: si algo falla,
--    el script CONTINÚA y las secciones siguientes (que son las
--    importantes) sí se ejecutan.
-- ---------------------------------------------------------------
do $$
begin
  drop view if exists public.clientes;
  drop table if exists public.envios;
exception when others then
  raise notice 'BENDITO SABOR: no se pudo limpiar clientes/envios: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------
-- 8) CERRAR VENTA (descuenta stock UNA vez y guarda el costo)
-- ---------------------------------------------------------------
create or replace function public.cerrar_venta(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.solicitudes%rowtype;
  it jsonb;
  v_costo_total numeric default 0;
  c_rec public.productos%rowtype;
  v_cant integer;
begin
  if not public.es_admin() then
    raise exception 'No autorizado';
  end if;

  select * into s from public.solicitudes where id = p_id;
  if not found then
    raise exception 'Pedido no encontrado';
  end if;

  if s.stock_descontado then
    return false;
  end if;

  if s.tipo <> 'pedido' then
    raise exception 'Solo aplica a pedidos del catálogo';
  end if;

  for it in
    select value from jsonb_array_elements(coalesce(s.detalles -> 'items', '[]'::jsonb))
  loop
    v_cant := case
      when public.es_entero(it ->> 'cantidad', 4)
        then greatest(1, least(9999, (it ->> 'cantidad')::int))
      else 1
    end;

    if public.es_uuid(it ->> 'id') then
      update public.productos
         set stock = greatest(coalesce(stock, 0) - v_cant, 0)
       where id = (it ->> 'id')::uuid;

      select * into c_rec from public.productos where id = (it ->> 'id')::uuid;
      if c_rec.costo is not null then
        v_costo_total := v_costo_total + c_rec.costo * v_cant;
      end if;
    end if;
  end loop;

  update public.solicitudes
     set estado = 'atendida',
         fecha_cierre = coalesce(s.fecha_cierre, now()),
         stock_descontado = true,
         detalles = jsonb_set(coalesce(s.detalles, '{}'::jsonb), '{costo_total}', to_jsonb(v_costo_total))
   where id = p_id;

  return true;
end;
$$;

revoke all on function public.cerrar_venta(uuid) from public;
grant execute on function public.cerrar_venta(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 10) CONSULTA PÚBLICA POR CÓDIGO (no expone contacto ni comprobante)
-- ---------------------------------------------------------------
drop function if exists public.consultar_pedido(text);

create function public.consultar_pedido(p_codigo text)
returns table (
  codigo text,
  estado text,
  creado timestamptz,
  fecha_cierre timestamptz,
  fecha_garantia timestamptz,
  metodo_pago text,
  total integer,
  items jsonb,
  stock_descontado boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(p_codigo, '') = ''
     or length(p_codigo) <> 8
     or left(p_codigo, 3) <> 'BS-'
     or translate(substr(p_codigo, 4), '0123456789', '') <> '' then
    return;
  end if;
  return query
    select s.codigo, s.estado, s.created_at, s.fecha_cierre, s.fecha_garantia,
           s.metodo_pago,
           case when public.es_entero(s.detalles ->> 'total', 12)
                then (s.detalles ->> 'total')::int else null end,
           s.detalles -> 'items',
           s.stock_descontado
    from public.solicitudes s
    where s.codigo = upper(trim(p_codigo));
end;
$$;

revoke all on function public.consultar_pedido(text) from public;
grant execute on function public.consultar_pedido(text) to anon, authenticated;

-- Normaliza y valida la ruta (o URL) de un archivo de un bucket privado.
-- Acepta únicamente:
--   1) ruta relativa  ->  comprobantes/uuid.jpg   (o con "/" inicial)
--   2) URL de ese mismo bucket en un proyecto *.supabase.co
-- Cualquier otra cosa se guarda como texto vacío, de modo que nadie pueda
-- inyectar rutas de otros buckets ni destinos externos.
--
-- IMPORTANTE: esta función NO usa expresiones regulares. Se valida con
-- translate()/position()/substr(), porque un patrón mal formado provoca el error
-- 2201B ("invalid regular expression: invalid repetition count(s)") y hace que
-- NINGÚN pedido pueda guardarse.
create or replace function public.ruta_archivo_privada(p_valor text, p_bucket text)
returns text
language plpgsql
immutable
as $$
declare
  v      text;
  v_low  text;
  b      text;
  marca  constant text := '/storage/v1/object/';
  tipo   text;
  i      integer;
  v_pref text;
  v_host text;
begin
  b := lower(coalesce(p_bucket, ''));
  -- El nombre del bucket solo puede contener [a-z_] (translate deja los sobrantes)
  if b = '' or translate(b, 'abcdefghijklmnopqrstuvwxyz_', '') <> '' then
    return '';
  end if;

  v := ltrim(coalesce(p_valor, ''), '/');
  if v = '' or length(v) > 500 or position('..' in v) > 0 then
    return '';
  end if;

  v_low := lower(v);
  if substr(v, 1, 8) = 'https://' then
    -- Solo URLs https de un proyecto Supabase propio
    v_host := split_part(substr(v, 9), '/', 1);
    if v_host not like '%.supabase.co' then return ''; end if;
    v := split_part(v, '?', 1);                    -- quita la query (?token=...)
    v_low := lower(v);
    i := position(marca in v_low);
    if i = 0 then return ''; end if;
    tipo := lower(split_part(substr(v, i + length(marca)), '/', 1));
    if tipo not in ('public', 'sign', 'render') then return ''; end if;
    -- salta: marca + tipo + "/"  (i es 1-based, por eso +1)
    v := substr(v, i + length(marca) + length(tipo) + 1);
  elsif v_low like 'http%' then
    return '';                                    -- http:// u otros esquemas
  end if;

  -- Debe pertenecer exactamente a este bucket
  v_pref := b || '/';
  if lower(substr(v, 1, length(v_pref))) <> v_pref then return ''; end if;
  v := v_pref || substr(v, length(v_pref) + 1);

  -- La clave del archivo solo admite caracteres seguros (sin query, sin %20...)
  if length(v) > 300 or translate(v, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-/', '') <> '' then
    return '';
  end if;

  return v;
end;
$$;

revoke all on function public.ruta_archivo_privada(text, text) from public;
grant execute on function public.ruta_archivo_privada(text, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- 11) CREAR PEDIDO / ENCARGO DESDE LA TIENDA
--     Limpian y validan todo en el servidor: aquí es donde se evita que
--     un visitante falsifique precios, estados o el total.
-- ---------------------------------------------------------------
create or replace function public.crear_pedido(
  p_nombre text,
  p_whatsapp text default '',
  p_correo text default '',
  p_detalles jsonb default '{}'::jsonb,
  p_mensaje_wa text default '',
  p_metodo_pago text default '',
  p_comprobante_url text default ''
)
returns public.solicitudes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.solicitudes;
  v_det jsonb := coalesce(p_detalles, '{}'::jsonb);
  v_items jsonb := '[]'::jsonb;
  v_tot text;
begin
  -- IMPORTANTE: las validaciones de esta función NO usan expresiones regulares
  -- (translate() en lugar de ~ / regexp_*). Un patrón mal formado aborta TODOS
  -- los pedidos con el error 2201B "invalid regular expression".
  v_tot := coalesce(v_det ->> 'total', '');
  if not public.es_entero(v_tot, 12) then v_tot := null; end if;

  if jsonb_typeof(v_det -> 'items') = 'array' then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', case when public.es_uuid(it ->> 'id') then lower(it ->> 'id') end,
             'nombre', left(translate(coalesce(it ->> 'nombre', ''), '<>"', ''), 120),
             'presentacion', left(translate(coalesce(it ->> 'presentacion', ''), '<>"', ''), 40),
             'categoria', left(translate(coalesce(it ->> 'categoria', ''), '<>"', ''), 40),
             'cantidad', case when public.es_entero(it ->> 'cantidad', 4)
                              then greatest(1, least(9999, (it ->> 'cantidad')::int)) else 1 end,
             'subtotal', case when public.es_entero(it ->> 'subtotal', 12)
                              then (it ->> 'subtotal')::int end
           )) order by ord), '[]'::jsonb)
      into v_items
      from (
        select value as it, ordinality as ord
        from jsonb_array_elements(v_det -> 'items') with ordinality
        limit 60
      ) t;
  end if;

  v_det := jsonb_build_object(
    'items', v_items,
    'total', v_tot::int
  );

  insert into public.solicitudes
    (tipo, nombre, whatsapp, correo, detalles, mensaje_wa, metodo_pago,
     comprobante_url, codigo, stock_descontado, estado)
  values
    ('pedido',
     left(trim(coalesce(p_nombre, '')), 120),
      left(public.solo_digitos(p_whatsapp), 20),
     left(lower(trim(coalesce(p_correo, ''))), 160),
     v_det,
     left(coalesce(p_mensaje_wa, ''), 8000),
     left(coalesce(p_metodo_pago, ''), 40),
     public.ruta_archivo_privada(p_comprobante_url, 'comprobantes'),
     null, false, 'nueva')
  returning * into r;

  return r;
end;
$$;

revoke all on function public.crear_pedido(text, text, text, jsonb, text, text, text) from public;
grant execute on function public.crear_pedido(text, text, text, jsonb, text, text, text) to anon, authenticated;

create or replace function public.crear_encargo(
  p_nombre text,
  p_whatsapp text default '',
  p_correo text default '',
  p_detalles jsonb default '{}'::jsonb,
  p_mensaje_wa text default '',
  p_comprobante_url text default ''
)
returns public.solicitudes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.solicitudes;
  v_det jsonb := coalesce(p_detalles, '{}'::jsonb);
  v_tot text;
begin
  -- Solo se conservan los textos del asistente de torta personalizada
  v_tot := coalesce(v_det ->> 'total', '');
  if not public.es_entero(v_tot, 12) then v_tot := null; end if;
  v_det := jsonb_build_object(
    'tipo', 'torta_personalizada',
    'tamano', left(translate(coalesce(v_det ->> 'tamano', ''), '[]{}<>"', ''), 60),
    'sabor', left(translate(coalesce(v_det ->> 'sabor', ''), '[]{}<>"', ''), 60),
    'ocasion', left(translate(coalesce(v_det ->> 'ocasion', ''), '[]{}<>"', ''), 120),
    'fecha', left(coalesce(v_det ->> 'fecha', ''), 20),
    'decoracion', left(translate(coalesce(v_det ->> 'decoracion', ''), '[]{}<>"', ''), 400),
    'mensaje', left(translate(coalesce(v_det ->> 'mensaje', ''), '[]{}<>"', ''), 1000),
     'referencia_url', public.ruta_archivo_privada(v_det ->> 'referencia_url', 'referencias'),
    'total', v_tot::int
  );

  insert into public.solicitudes
    (tipo, nombre, whatsapp, correo, detalles, mensaje_wa, metodo_pago,
     comprobante_url, codigo, stock_descontado, estado)
  values
    ('encargo',
     left(trim(coalesce(p_nombre, '')), 120),
      left(public.solo_digitos(p_whatsapp), 20),
     left(lower(trim(coalesce(p_correo, ''))), 160),
     v_det,
     left(coalesce(p_mensaje_wa, ''), 8000),
     '',
     public.ruta_archivo_privada(p_comprobante_url, 'referencias'),
     null, false, 'nueva')
  returning * into r;

  return r;
end;
$$;

revoke all on function public.crear_encargo(text, text, text, jsonb, text, text) from public;
grant execute on function public.crear_encargo(text, text, text, jsonb, text, text) to anon, authenticated;

-- Backfill: asigna código a solicitudes creadas antes de esta versión
do $$
declare r record;
declare c text;
begin
  for r in select id from public.solicitudes where codigo is null or trim(codigo) = '' loop
    loop
      c := 'BS-' || lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
      exit when not exists (select 1 from public.solicitudes where codigo = c);
    end loop;
    update public.solicitudes set codigo = c where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- 12) BANNERS PUBLICITARIOS
-- ---------------------------------------------------------------
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  titulo text default '',
  subtitulo text default '',
  imagen_url text default '',
  enlace text default '',
  orden integer default 0,
  activo boolean default true,
  created_at timestamptz default now()
);

create index if not exists banners_orden_idx on public.banners (orden, created_at);

alter table public.banners enable row level security;

drop policy if exists "banners_lectura_publica" on public.banners;
create policy "banners_lectura_publica"
  on public.banners for select
  using (activo is true);

drop policy if exists "banners_admin_select" on public.banners;
create policy "banners_admin_select"
  on public.banners for select
  using (public.es_admin());

drop policy if exists "banners_admin_insert" on public.banners;
create policy "banners_admin_insert"
  on public.banners for insert
  with check (public.es_admin());

drop policy if exists "banners_admin_update" on public.banners;
create policy "banners_admin_update"
  on public.banners for update
  using (public.es_admin())
  with check (public.es_admin());

drop policy if exists "banners_admin_delete" on public.banners;
create policy "banners_admin_delete"
  on public.banners for delete
  using (public.es_admin());

-- ---------------------------------------------------------------
-- 13) GALERÍA · CLIENTES FELICES (carrusel de la sección Encargos)
-- ---------------------------------------------------------------
create table if not exists public.galeria (
  id uuid primary key default gen_random_uuid(),
  titulo text default '',
  texto text default '',
  imagen_url text default '',
  orden integer default 0,
  activo boolean default true,
  created_at timestamptz default now()
);

create index if not exists galeria_orden_idx on public.galeria (orden, created_at);

alter table public.galeria enable row level security;

drop policy if exists "galeria_lectura_publica" on public.galeria;
create policy "galeria_lectura_publica"
  on public.galeria for select
  using (activo is true);

drop policy if exists "galeria_admin_select" on public.galeria;
create policy "galeria_admin_select"
  on public.galeria for select
  using (public.es_admin());

drop policy if exists "galeria_admin_insert" on public.galeria;
create policy "galeria_admin_insert"
  on public.galeria for insert
  with check (public.es_admin());

drop policy if exists "galeria_admin_update" on public.galeria;
create policy "galeria_admin_update"
  on public.galeria for update
  using (public.es_admin())
  with check (public.es_admin());

drop policy if exists "galeria_admin_delete" on public.galeria;
create policy "galeria_admin_delete"
  on public.galeria for delete
  using (public.es_admin());

-- ---------------------------------------------------------------
-- 14) STORAGE · BUCKETS
-- ---------------------------------------------------------------
-- 14.1 Imágenes de banners (público, escribe el admin)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "storage_banners_lectura" on storage.objects;
create policy "storage_banners_lectura"
  on storage.objects for select
  using (bucket_id = 'banners');

drop policy if exists "storage_banners_insert" on storage.objects;
create policy "storage_banners_insert"
  on storage.objects for insert
  with check (bucket_id = 'banners' and public.es_admin());

drop policy if exists "storage_banners_update" on storage.objects;
create policy "storage_banners_update"
  on storage.objects for update
  using (bucket_id = 'banners' and public.es_admin());

drop policy if exists "storage_banners_delete" on storage.objects;
create policy "storage_banners_delete"
  on storage.objects for delete
  using (bucket_id = 'banners' and public.es_admin());

-- 14.2 Fotos de clientes felices (público, escribe el admin)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('galeria', 'galeria', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "storage_galeria_lectura" on storage.objects;
create policy "storage_galeria_lectura"
  on storage.objects for select
  using (bucket_id = 'galeria');

drop policy if exists "storage_galeria_insert" on storage.objects;
create policy "storage_galeria_insert"
  on storage.objects for insert
  with check (bucket_id = 'galeria' and public.es_admin());

drop policy if exists "storage_galeria_update" on storage.objects;
create policy "storage_galeria_update"
  on storage.objects for update
  using (bucket_id = 'galeria' and public.es_admin());

drop policy if exists "storage_galeria_delete" on storage.objects;
create policy "storage_galeria_delete"
  on storage.objects for delete
  using (bucket_id = 'galeria' and public.es_admin());

-- 14.3 Comprobantes de pago · PRIVADO
--     El cliente sí puede subir su captura (anónimo), pero solo el admin
--     puede verla: el panel abre URLs firmadas que caducan en 1 hora.
--     Antes era un bucket público y cualquiera podía descargar en masa
--     los comprobantes bancarios de todos los clientes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "storage_comprobantes_lectura" on storage.objects;
create policy "storage_comprobantes_lectura"
  on storage.objects for select
  using (bucket_id = 'comprobantes' and public.es_admin());

-- Solo se puede subir, nunca sobrescribir
drop policy if exists "storage_comprobantes_insert_publico" on storage.objects;
create policy "storage_comprobantes_insert_publico"
  on storage.objects for insert
  with check (bucket_id = 'comprobantes');

drop policy if exists "storage_comprobantes_update" on storage.objects;
create policy "storage_comprobantes_update"
  on storage.objects for update
  using (bucket_id = 'comprobantes' and public.es_admin());

drop policy if exists "storage_comprobantes_delete" on storage.objects;
create policy "storage_comprobantes_delete"
  on storage.objects for delete
  using (bucket_id = 'comprobantes' and public.es_admin());

-- 14.4 Imágenes de referencia de tortas personalizadas · PRIVADO
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('referencias', 'referencias', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "storage_referencias_lectura" on storage.objects;
create policy "storage_referencias_lectura"
  on storage.objects for select
  using (bucket_id = 'referencias' and public.es_admin());

drop policy if exists "storage_referencias_insert_publico" on storage.objects;
create policy "storage_referencias_insert_publico"
  on storage.objects for insert
  with check (bucket_id = 'referencias');

drop policy if exists "storage_referencias_update" on storage.objects;
create policy "storage_referencias_update"
  on storage.objects for update
  using (bucket_id = 'referencias' and public.es_admin());

drop policy if exists "storage_referencias_delete" on storage.objects;
create policy "storage_referencias_delete"
  on storage.objects for delete
  using (bucket_id = 'referencias' and public.es_admin());

-- 14.5 Tope de subidas anónimas (evita abuso del almacenamiento gratuito)
create or replace function public.storage_limitar_anon()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    return new;
  end if;
  if new.bucket_id in ('comprobantes', 'referencias') then
    if (select count(*) from storage.objects
         where bucket_id = new.bucket_id
           and created_at > now() - interval '1 hour') >= 25 then
      raise exception 'Demasiadas imágenes subidas. Intenta de nuevo en un momento.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_storage_limitar_anon on storage.objects;
create trigger trg_storage_limitar_anon
  before insert on storage.objects
  for each row execute function public.storage_limitar_anon();

-- ---------------------------------------------------------------
-- 15) BOOTSTRAP DEL ADMINISTRADOR
--     Registra como admin al usuario más antiguo de Authentication
--     cuando la lista está vacía O contiene correos que ya no existen
--     (típico: correste el script antes de crear tu usuario). Es
--     idempotente, así que puedes reejecutar el script para repararlo.
--
--     Para dar permisos a un correo concreto:
--       insert into public.admins (email) values ('TU@CORREO.COM')
--       on conflict (email) do nothing;
--
--     Para dar permisos a TODOS los usuarios existentes (con cuidado):
--       insert into public.admins (email)
--       select lower(email) from auth.users where email is not null
--       on conflict (email) do nothing;
-- ---------------------------------------------------------------
do $$
declare v_email text;
declare n integer := 0;
begin
  select count(*) into n
  from public.admins a
  where exists (
    select 1 from auth.users u where lower(u.email) = lower(a.email)
  );

  if n = 0 then
    select lower(email) into v_email
    from auth.users
    where email is not null
    order by created_at asc
    limit 1;

    if v_email is not null then
      insert into public.admins (email) values (v_email) on conflict (email) do nothing;
      raise notice 'BENDITO SABOR: administrador bootstrap -> %', v_email;
    else
      raise warning 'BENDITO SABOR: no hay usuarios en Authentication. Crea tu usuario y vuelve a ejecutar este script.';
    end if;
  end if;
end $$;

-- ================================================================
-- LISTA DE VERIFICACIÓN
--   [ ] Ejecutaste este script en SQL Editor
--   [ ] Authentication → Users → creaste tu usuario admin
--   [ ] Authentication → Sign In / Providers → Email → desactiva
--       "Enable email signup" (para que nadie más pueda registrarse)
--   [ ] js/config.js tiene la URL y la publishable key del proyecto
--   [ ] js/store.js tiene tu número de WhatsApp
-- ================================================================
