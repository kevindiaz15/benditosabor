/* ============================================================ */
/* BENDITO SABOR · Configuración de Supabase                    */
/*Estas claves son públicas por diseño. La seguridad de        */
/* escritura la garantizan las políticas RLS de Supabase:     */
/* solo los correos registrados en la tabla `admins` pueden    */
/* crear, editar, eliminar o subir archivos.                   */
/*                                                              */
/* Estructura del proyecto: Dashboard → SQL Editor → ejecuta   */
/* el archivo supabase.sql.                                     */
/* ============================================================ */
const SUPABASE_CONFIG = {
  url: 'https://nghwxhjurtsaikxroorp.supabase.co',
  key: 'sb_publishable_FVhqtOMplrEJ4ZdvB6JP5g_NhDinuqm'
};

/* ============================================================ */
/* BENDITO SABOR · Configuración EmailJS (correo masivo)        */
/* Crea una cuenta gratis en https://www.emailjs.com            */
/*   1. Service ID: Email Services → Add (Gmail, Outlook…)      */
/*   2. Template:  Email Templates → New, define las variables: */
/*        to_email, to_name, subject, message                   */
/*   3. Public key: la encuentras en Account → General          */
/* Pega aquí tus valores (los "TU-" son marcadores por llenar). */
/* ============================================================ */
const EMAILJS_CONFIG = {
  public_key: 'TU-EMAILJS-PUBLIC-KEY',
  service_id: 'TU-EMAILJS-SERVICE-ID',
  template_id: 'TU-EMAILJS-TEMPLATE-ID'
};
