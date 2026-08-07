
ALTER TABLE public.promo_packs
  ADD COLUMN IF NOT EXISTS pack_type TEXT NOT NULL DEFAULT 'carcasa+polera',
  ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}';

DROP TRIGGER IF EXISTS trg_promo_packs_pack_type_valid ON public.promo_packs;
CREATE OR REPLACE FUNCTION public.validate_promo_pack_type()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.pack_type NOT IN ('carcasa','carcasa+polera','carcasa+poleron') THEN
    RAISE EXCEPTION 'pack_type inválido: %', NEW.pack_type;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_promo_packs_pack_type_valid
  BEFORE INSERT OR UPDATE ON public.promo_packs
  FOR EACH ROW EXECUTE FUNCTION public.validate_promo_pack_type();

INSERT INTO public.promo_packs (name, description, price, sale_price, gradient, tag, pack_type, includes, features, sort_order, is_active)
SELECT v.name, v.description, v.price::numeric, v.sale_price::numeric, v.gradient, v.tag, v.pack_type, v.includes, v.features, v.sort_order, v.is_active
FROM (VALUES
  ('Solo Carcasa'::text, 'Tu carcasa premium personalizada al 100%.'::text, 8990, NULL::numeric, 'from-green-400 to-emerald-500'::text, ''::text, 'carcasa'::text,
   ARRAY['Carcasa premium'], ARRAY['Carcasa premium personalizada','Impresión sublimación HD','Compatible con todos los modelos','Envío en 3-5 días'], 0, true),
  ('Carcasa + Polera', 'Combo urbano: carcasa + polera oversize personalizada.', 21990, NULL, 'from-blue-500 to-cyan-400', 'Bestseller', 'carcasa+polera',
   ARRAY['Carcasa premium','Polera oversize'], ARRAY['Carcasa premium personalizada','Polera oversize algodón peinado','Impresión sublimación HD','Envío en 3-5 días'], 1, true),
  ('Carcasa + Polerón', 'Pack completo: carcasa + polerón con capucha personalizado.', 29990, NULL, 'from-fuchsia-500 to-indigo-600', 'Nuevo', 'carcasa+poleron',
   ARRAY['Carcasa premium','Polerón con capucha'], ARRAY['Carcasa premium personalizada','Polerón con capucha polar interior','Impresión sublimación HD','Envío en 3-5 días'], 2, true)
) AS v(name, description, price, sale_price, gradient, tag, pack_type, includes, features, sort_order, is_active)
WHERE NOT EXISTS (SELECT 1 FROM public.promo_packs);
