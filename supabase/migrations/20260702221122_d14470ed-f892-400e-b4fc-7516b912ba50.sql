
-- =========== ROLES / AUTH ===========
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Auto-create default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =========== CATALOG ===========
CREATE TABLE public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.brands TO anon, authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read brands" ON public.brands FOR SELECT USING (true);
CREATE POLICY "Admins write brands" ON public.brands FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER brands_updated BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.phone_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  mockup_url TEXT,
  mask_url TEXT,
  preview_url TEXT,
  width_mm NUMERIC,
  height_mm NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, slug)
);
GRANT SELECT ON public.phone_models TO anon, authenticated;
GRANT ALL ON public.phone_models TO service_role;
ALTER TABLE public.phone_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read phone_models" ON public.phone_models FOR SELECT USING (true);
CREATE POLICY "Admins write phone_models" ON public.phone_models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER phone_models_updated BEFORE UPDATE ON public.phone_models FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.garments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('polera','poleron')),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'black',
  sizes TEXT[] NOT NULL DEFAULT ARRAY['S','M','L','XL'],
  mockup_url TEXT,
  preview_url TEXT,
  price INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.garments TO anon, authenticated;
GRANT ALL ON public.garments TO service_role;
ALTER TABLE public.garments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read garments" ON public.garments FOR SELECT USING (true);
CREATE POLICY "Admins write garments" ON public.garments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER garments_updated BEFORE UPDATE ON public.garments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.template_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.template_categories TO anon, authenticated;
GRANT ALL ON public.template_categories TO service_role;
ALTER TABLE public.template_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read template_categories" ON public.template_categories FOR SELECT USING (true);
CREATE POLICY "Admins write template_categories" ON public.template_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER template_categories_updated BEFORE UPDATE ON public.template_categories FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES public.template_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  preview_url TEXT,
  file_url TEXT,
  psd_url TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.templates TO anon, authenticated;
GRANT ALL ON public.templates TO service_role;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read templates" ON public.templates FOR SELECT USING (true);
CREATE POLICY "Admins write templates" ON public.templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER templates_updated BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========== ORDERS ===========
CREATE TABLE public.custom_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  shipping_address JSONB,
  pack_type TEXT NOT NULL CHECK (pack_type IN ('carcasa+polera','carcasa+poleron')),
  total_amount INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CLP',
  status TEXT NOT NULL DEFAULT 'pending',
  shopify_order_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.custom_orders TO authenticated;
GRANT INSERT ON public.custom_orders TO anon;
GRANT ALL ON public.custom_orders TO service_role;
ALTER TABLE public.custom_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can create orders" ON public.custom_orders FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Users read own orders" ON public.custom_orders FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update orders" ON public.custom_orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER custom_orders_updated BEFORE UPDATE ON public.custom_orders FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.design_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.custom_orders(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_path TEXT,
  file_type TEXT,
  file_size_bytes BIGINT,
  kind TEXT CHECK (kind IN ('case','garment','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.design_assets TO anon, authenticated;
GRANT SELECT ON public.design_assets TO authenticated;
GRANT ALL ON public.design_assets TO service_role;
ALTER TABLE public.design_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert design_assets" ON public.design_assets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Admins read design_assets" ON public.design_assets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.final_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.custom_orders(id) ON DELETE CASCADE,
  phone_model_id UUID REFERENCES public.phone_models(id) ON DELETE SET NULL,
  garment_id UUID REFERENCES public.garments(id) ON DELETE SET NULL,
  garment_size TEXT,
  case_design JSONB,
  garment_design JSONB,
  case_preview_url TEXT,
  garment_preview_url TEXT,
  final_file_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.final_designs TO anon, authenticated;
GRANT SELECT, UPDATE ON public.final_designs TO authenticated;
GRANT ALL ON public.final_designs TO service_role;
ALTER TABLE public.final_designs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert final_designs" ON public.final_designs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Admins read final_designs" ON public.final_designs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update final_designs" ON public.final_designs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER final_designs_updated BEFORE UPDATE ON public.final_designs FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========== admin_users view alias ===========
-- keep an "admin_users" concept queryable
CREATE OR REPLACE VIEW public.admin_users AS
  SELECT user_id, created_at FROM public.user_roles WHERE role = 'admin';
GRANT SELECT ON public.admin_users TO authenticated;

-- =========== STORAGE POLICIES ===========
-- Public read on catalog buckets
CREATE POLICY "Public read catalog buckets" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('phone-mockups','phone-masks','phone-previews','garment-mockups','garment-previews','template-previews','final-designs'));

-- Admin write on catalog buckets
CREATE POLICY "Admins manage catalog buckets" ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id IN ('phone-mockups','phone-masks','phone-previews','garment-mockups','garment-previews','template-previews','template-files','source-psd-files','final-designs')
    AND public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    bucket_id IN ('phone-mockups','phone-masks','phone-previews','garment-mockups','garment-previews','template-previews','template-files','source-psd-files','final-designs')
    AND public.has_role(auth.uid(), 'admin')
  );

-- Customer uploads: anyone can upload, only admins can read
CREATE POLICY "Anyone upload customer-uploads" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'customer-uploads');
CREATE POLICY "Admins read customer-uploads" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'customer-uploads' AND public.has_role(auth.uid(), 'admin'));

-- Final designs writable by anyone (system saves them on checkout), readable public preview above
CREATE POLICY "Anyone insert final-designs" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'final-designs');
