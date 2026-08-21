import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const customizer = readFileSync(new URL("../routes/personalizador.tsx", import.meta.url), "utf8");
const stepModel = customizer.slice(customizer.indexOf("function StepModel("), customizer.indexOf("function CaseDesignCanvas("));

test("selector de celular conserva datos, orden y callbacks existentes", () => {
  assert.match(customizer, /\.from\("brands"\)[\s\S]*?\.order\("sort_order"\)/);
  assert.match(customizer, /\.from\("phone_models"\)[\s\S]*?\.order\("sort_order"\)/);
  assert.match(customizer, /\.in\("brand_id", group\.brandIds\)/);
  assert.doesNotMatch(customizer, /\.eq\("brand_id", brandId\)/);
  assert.match(customizer, /brandGroups\.map\(\(group\)/);
  assert.match(customizer, /models\.map\(\(m\)/);
  assert.match(customizer, /onClick=\{\(\) => onBrand\(group\.brandIds\[0\]\)\}/);
  assert.match(customizer, /onClick=\{\(\) => onModel\(m\)\}/);
  assert.match(customizer, /onBrand=\{\(id\) => \{ setBrandId\(id\); setModelId\(""\); \}\}/);
  assert.match(customizer, /setBrandId\(selectedModel\.brand_id\); setModelId\(selectedModel\.id\)/);
});

test("marcas y modelos son listas compactas, accesibles y con scroll vertical", () => {
  assert.match(stepModel, /role="listbox" aria-label="Marca"/);
  assert.match(stepModel, /role="listbox" aria-label="Modelo"/);
  assert.equal((stepModel.match(/role="option"/g) ?? []).length, 2);
  assert.equal((stepModel.match(/aria-selected=\{selected\}/g) ?? []).length, 2);
  assert.equal((stepModel.match(/max-h-\[280px\]/g) ?? []).length, 2);
  assert.equal((stepModel.match(/overflow-x-hidden overflow-y-auto/g) ?? []).length, 2);
  assert.equal((stepModel.match(/min-h-10 w-full/g) ?? []).length, 2);
  assert.match(stepModel, /grid min-w-0 gap-6 md:grid-cols-2/);
});

test("selección, molde, Siguiente y Resumen conservan su contrato", () => {
  assert.match(customizer, /const model = models\.find\(\(m\) => m\.id === modelId\)/);
  assert.match(customizer, /if \(step === 1\) return !!modelId/);
  assert.match(customizer, /<StepCase design=\{caseDesign\} onChange=\{setCaseDesign\} model=\{model\} \/>/);
  assert.match(customizer, /<h3 className="font-display text-lg font-semibold">Resumen<\/h3>/);
  assert.match(customizer, /<Row k="Marca" v=\{brand\?\.name/);
  assert.match(customizer, /<Row k="Modelo" v=\{model\?\.name/);
});
