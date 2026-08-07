
CREATE POLICY "cms-media public read" ON storage.objects FOR SELECT USING (bucket_id = 'cms-media');
CREATE POLICY "cms-media admin insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'cms-media' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "cms-media admin update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'cms-media' AND public.has_role(auth.uid(),'admin')) WITH CHECK (bucket_id = 'cms-media' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "cms-media admin delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'cms-media' AND public.has_role(auth.uid(),'admin'));
