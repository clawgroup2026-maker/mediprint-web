-- =====================================================================
-- 20260913120400 · Vía pública y limitada para registrar solicitudes
-- ---------------------------------------------------------------------
-- La web pública NO tiene permisos sobre quote_requests. Solo puede
-- llamar a public.submit_quote_request(payload), que:
--   * valida estructura, longitudes y cantidad de ítems,
--   * recalcula neto / IVA / total en servidor (no confía en el cliente),
--   * enlaza productos por nombre solo si están activos,
--   * aplica un límite simple por IP (hash SHA-256, la IP no se guarda),
--   * ignora silenciosamente envíos con el campo trampa `website`.
-- Nunca devuelve datos de otras solicitudes.
-- =====================================================================

create or replace function public.submit_quote_request(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source     text;
  v_contact    jsonb;
  v_items      jsonb;
  v_item       jsonb;
  v_headers    jsonb;
  v_ip         text;
  v_fp         text;
  v_quote_id   uuid;
  v_number     text;
  v_net        bigint := 0;
  v_packs      integer;
  v_price      integer;
  v_extras     text[];
  v_date       date;
  v_qty        integer;
  v_product_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Solicitud inválida' using errcode = '22023';
  end if;

  if octet_length(p_payload::text) > 40000 then
    raise exception 'Solicitud demasiado grande' using errcode = '22023';
  end if;

  -- Campo trampa para bots: responder OK sin guardar nada
  if coalesce(p_payload ->> 'website', '') <> '' then
    return jsonb_build_object('ok', true);
  end if;

  v_source := p_payload ->> 'source';
  if v_source not in ('carrito_web', 'formulario_cotizacion') or v_source is null then
    raise exception 'Origen inválido' using errcode = '22023';
  end if;

  -- Límite por IP: máx. 5 solicitudes cada 10 minutos
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(
    v_headers ->> 'cf-connecting-ip',
    split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
    ''
  );
  if trim(v_ip) <> '' then
    v_fp := encode(sha256(convert_to('mediprint:' || trim(v_ip), 'UTF8')), 'hex');
    if (select count(*) from public.quote_requests q
         where q.client_fingerprint = v_fp
           and q.created_at > now() - interval '10 minutes') >= 5 then
      raise exception 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.' using errcode = '54000';
    end if;
  end if;

  -- Límite global de seguridad: máx. 60 solicitudes por minuto
  if (select count(*) from public.quote_requests q
       where q.created_at > now() - interval '1 minute'
         and q.source in ('carrito_web', 'formulario_cotizacion')) >= 60 then
    raise exception 'Servicio temporalmente saturado' using errcode = '54000';
  end if;

  v_contact := coalesce(p_payload -> 'contact', '{}'::jsonb);
  if jsonb_typeof(v_contact) <> 'object' then
    raise exception 'Contacto inválido' using errcode = '22023';
  end if;

  v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 30 then
    raise exception 'Ítems inválidos' using errcode = '22023';
  end if;

  if v_source = 'carrito_web' and jsonb_array_length(v_items) = 0 then
    raise exception 'El carrito está vacío' using errcode = '22023';
  end if;

  if v_source = 'formulario_cotizacion' then
    if char_length(trim(coalesce(v_contact ->> 'name', ''))) not between 2 and 120
       or char_length(trim(coalesce(v_contact ->> 'phone', ''))) not between 6 and 30
       or coalesce(v_contact ->> 'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       or char_length(v_contact ->> 'email') > 254
       or char_length(trim(coalesce(p_payload ->> 'product_summary', ''))) not between 1 and 200
       or char_length(trim(coalesce(p_payload ->> 'description', ''))) not between 1 and 3000 then
      raise exception 'Datos del formulario incompletos o inválidos' using errcode = '22023';
    end if;
  end if;

  if coalesce(p_payload ->> 'requested_quantity', '') ~ '^[0-9]{1,7}$' then
    v_qty := nullif((p_payload ->> 'requested_quantity')::integer, 0);
  end if;

  if coalesce(p_payload ->> 'required_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_date := (p_payload ->> 'required_date')::date;
    exception when others then
      v_date := null;
    end;
  end if;

  insert into public.quote_requests (
    source, contact_name, company, email, phone,
    product_summary, requested_quantity, required_date, description, client_fingerprint
  ) values (
    v_source,
    left(nullif(trim(v_contact ->> 'name'), ''), 120),
    left(nullif(trim(v_contact ->> 'company'), ''), 160),
    left(nullif(lower(trim(v_contact ->> 'email')), ''), 254),
    left(nullif(trim(v_contact ->> 'phone'), ''), 30),
    left(nullif(trim(p_payload ->> 'product_summary'), ''), 200),
    v_qty,
    v_date,
    left(nullif(trim(p_payload ->> 'description'), ''), 3000),
    v_fp
  )
  returning id, quote_number into v_quote_id, v_number;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or char_length(trim(coalesce(v_item ->> 'product_name', ''))) not between 1 and 160
       or coalesce(v_item ->> 'packs', '') !~ '^[0-9]{1,4}$'
       or coalesce(v_item ->> 'unit_net_price', '0') !~ '^[0-9]{1,9}$' then
      raise exception 'Ítem inválido' using errcode = '22023';
    end if;

    v_packs := (v_item ->> 'packs')::integer;
    v_price := coalesce((v_item ->> 'unit_net_price')::integer, 0);
    if v_packs < 1 or v_packs > 1000 then
      raise exception 'Cantidad inválida' using errcode = '22023';
    end if;

    v_extras := '{}';
    if jsonb_typeof(v_item -> 'extras') = 'array' then
      select coalesce(array_agg(left(trim(e), 80)), '{}')
        into v_extras
      from (
        select jsonb_array_elements_text(v_item -> 'extras') as e
        limit 10
      ) s
      where trim(e) <> '';
    end if;

    select p.id into v_product_id
    from public.products p
    where p.is_active and p.name = trim(v_item ->> 'product_name')
    limit 1;

    insert into public.quote_request_items (
      quote_request_id, product_id, product_name, option_label, quantity_label, extras, packs, unit_net_price
    ) values (
      v_quote_id,
      v_product_id,
      left(trim(v_item ->> 'product_name'), 160),
      left(nullif(trim(v_item ->> 'option'), ''), 200),
      left(nullif(trim(v_item ->> 'quantity_label'), ''), 120),
      v_extras,
      v_packs,
      v_price
    );

    v_net := v_net + v_packs::bigint * v_price;
  end loop;

  if v_net > 2000000000 then
    raise exception 'Monto fuera de rango' using errcode = '22023';
  end if;

  update public.quote_requests
     set net_amount   = v_net,
         vat_amount   = round(v_net * 0.19),
         total_amount = v_net + round(v_net * 0.19)
   where id = v_quote_id;

  return jsonb_build_object('ok', true, 'quote_number', v_number);
end;
$$;

comment on function public.submit_quote_request(jsonb) is 'Única vía de escritura pública: registra una solicitud de cotización validada.';

revoke all on function public.submit_quote_request(jsonb) from public;
grant execute on function public.submit_quote_request(jsonb) to anon, authenticated;
