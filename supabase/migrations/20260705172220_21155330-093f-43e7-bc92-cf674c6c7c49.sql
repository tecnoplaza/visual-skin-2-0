
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS view text NOT NULL DEFAULT 'front';
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS source_psd_url text;
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS overlay_url text;
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS print_area jsonb;
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS mold_status text NOT NULL DEFAULT 'pendiente_conversion';
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS processing_error text;
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS source_width integer;
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS source_height integer;

UPDATE public.garments SET view = 'front' WHERE view IS NULL;

UPDATE public.garments
   SET mold_status = CASE
     WHEN mockup_url IS NOT NULL AND length(btrim(mockup_url)) > 0 THEN 'listo'
     ELSE 'pendiente_conversion'
   END
 WHERE mold_status IS NULL
    OR mold_status NOT IN ('pendiente_conversion','listo','error_conversion');

UPDATE public.garments
   SET slug = lower(
     regexp_replace(
       regexp_replace(
         coalesce(type,'') || '-' || coalesce(name,'') || '-' || coalesce(color,'') || '-' || coalesce(view,'front'),
         '[^a-zA-Z0-9]+', '-', 'g'
       ),
       '(^-+|-+$)', '', 'g'
     )
   )
 WHERE slug IS NULL OR length(btrim(slug)) = 0;

CREATE UNIQUE INDEX IF NOT EXISTS garments_slug_unique_notnull
  ON public.garments (slug)
  WHERE slug IS NOT NULL;
