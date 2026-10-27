import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, VaultError, sanitizeFileName } from "../src/core/vault.ts";
import { tmpVault } from "./helpers.ts";

test("no permite salir de la raíz ni rutas absolutas ni .kioku para notas", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const v = new Vault(root);
    assert.throws(() => v.abs("../fuera.md"), (e: VaultError) => e.code === "outside-root");
    assert.throws(() => v.abs("/etc/passwd"), (e: VaultError) => e.code === "outside-root");
    assert.throws(() => v.abs("a/../../x"), (e: VaultError) => e.code === "outside-root");
    await assert.rejects(v.write(".kioku/x.md", "a"), (e: VaultError) => e.code === "invalid");
  } finally { cleanup(); }
});

test("escritura con detección de conflicto y de existencia", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const v = new Vault(root);
    const { hash } = await v.write("n.md", "uno", null);
    await assert.rejects(v.write("n.md", "dos", null), (e: VaultError) => e.code === "exists");
    await v.write("n.md", "dos", hash);
    await assert.rejects(v.write("n.md", "tres", hash), (e: VaultError) => e.code === "conflict");
    assert.equal((await v.read("n.md")).text, "dos");
  } finally { cleanup(); }
});

test("borrar = papelera recuperable; uniquePath evita pisar", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const v = new Vault(root);
    await v.write("a.md", "x");
    assert.equal(v.uniquePath("a.md"), "a-2.md");
    const t = await v.trash("a.md");
    assert.equal(v.exists("a.md"), false);
    assert.equal(v.exists(t), true);
  } finally { cleanup(); }
});

test("sanitizeFileName conserva acentos y quita caracteres peligrosos", () => {
  assert.equal(sanitizeFileName("¿Qué/hacer? [[hoy]] #1"), "¿Qué hacer hoy 1");
  assert.equal(sanitizeFileName("..."), "Sin título");
});
