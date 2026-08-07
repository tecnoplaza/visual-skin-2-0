CREATE OR REPLACE FUNCTION public.validate_promo_pack_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.pack_type NOT IN ('carcasa','carcasa+polera','carcasa+poleron','carcasa+polera+poleron') THEN
    RAISE EXCEPTION 'pack_type inválido: %', NEW.pack_type;
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO public.promo_packs (
  name, description, price, sale_price, tag, gradient, pack_type,
  includes, features, sort_order, is_active
)
SELECT
  'Carcasa + Polera + Polerón',
  'Pack completo con carcasa, polera y polerón personalizados.',
  44990,
  NULL,
  'Pack completo',
  'from-violet-500 to-fuchsia-500',
  'carcasa+polera+poleron',
  ARRAY['Carcasa premium','Polera personalizada','Polerón personalizado'],
  ARRAY['Carcasa premium personalizada','Polera personalizada','Polerón personalizado','Tres diseños independientes','Envío en 3-5 días'],
  (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM public.promo_packs),
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.promo_packs WHERE pack_type = 'carcasa+polera+poleron'
);