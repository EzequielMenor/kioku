import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ModelConfigError, describeCredentials, kiokuCredentialsPath, removeKiokuSecret, resolveProviderSecrets, saveKiokuSecret,
} from "../src/assistant/model-config.ts";

// Almacén propio de claves de Kioku (credentials.env), fuera de la bóveda. Siempre con un home temporal.
const SECRET = ["sk", "SENTINELA", "no", "debe", "aparecer", "9f3a1c77" + "d0b24e5a"].join("-");

function home() {
  const root = mkdtempSync(path.join(tmpdir(), "kioku-cred-"));
  const userHome = path.join(root, "userhome");
  mkdirSync(path.join(userHome, ".hermes"), { recursive: true });
  const o = { userHome, env: {} as NodeJS.ProcessEnv };
  return { root, userHome, o, file: kiokuCredentialsPath(userHome, o.env), done: () => rmSync(root, { recursive: true, force: true }) };
}
const mode = (p: string) => statSync(p).mode & 0o777;

test("ruta del almacén: Application Support en macOS; XDG o ~/.config en el resto; siempre bajo el home recibido", () => {
  assert.equal(kiokuCredentialsPath("/h", {}, "darwin"), path.join("/h", "Library", "Application Support", "Kioku", "credentials.env"));
  assert.equal(kiokuCredentialsPath("/h", { XDG_CONFIG_HOME: "/x/cfg" }, "darwin"), path.join("/h", "Library", "Application Support", "Kioku", "credentials.env"));
  assert.equal(kiokuCredentialsPath("/h", {}, "linux"), path.join("/h", ".config", "kioku", "credentials.env"));
  assert.equal(kiokuCredentialsPath("/h", { XDG_CONFIG_HOME: "/x/cfg" }, "linux"), path.join("/x/cfg", "kioku", "credentials.env"));
  assert.equal(kiokuCredentialsPath("/h", { XDG_CONFIG_HOME: "relativa" }, "linux"), path.join("/h", ".config", "kioku", "credentials.env"), "XDG relativo se ignora");
});

test("guardar: crea directorio 0700 y fichero 0600 con NOMBRE=valor; el nombre lo elige el servidor (keys[0])", async () => {
  const h = home();
  try {
    await saveKiokuSecret("gemini", SECRET, h.o);
    assert.equal(readFileSync(h.file, "utf8"), `GOOGLE_API_KEY=${SECRET}\n`);
    assert.equal(mode(h.file), 0o600);
    assert.equal(mode(path.dirname(h.file)), 0o700);
    assert.deepEqual(readdirSync(path.dirname(h.file)), ["credentials.env"], "escritura atómica: sin temporales");
  } finally { h.done(); }
});

test("guardar corrige permisos laxos de un fichero y un directorio ya existentes", async () => {
  const h = home();
  try {
    mkdirSync(path.dirname(h.file), { recursive: true, mode: 0o755 });
    chmodSync(path.dirname(h.file), 0o755);
    writeFileSync(h.file, "OPENROUTER_API_KEY=viejo\n", { mode: 0o644 });
    chmodSync(h.file, 0o644);
    await saveKiokuSecret("openrouter", SECRET, h.o);
    assert.equal(mode(h.file), 0o600);
    assert.equal(mode(path.dirname(h.file)), 0o700);
  } finally { h.done(); }
});

test("guardar conserva las demás líneas y reemplaza solo la variable (sin duplicarla)", async () => {
  const h = home();
  try {
    mkdirSync(path.dirname(h.file), { recursive: true });
    writeFileSync(h.file, "# mis claves\nANTHROPIC_API_KEY=ant-1\nOPENCODE_GO_API_KEY=viejo\n\nOPENCODE_GO_API_KEY=otro-viejo\n");
    await saveKiokuSecret("opencode-go", SECRET, h.o);
    assert.equal(readFileSync(h.file, "utf8"), `# mis claves\nANTHROPIC_API_KEY=ant-1\nOPENCODE_GO_API_KEY=${SECRET}\n\n`);
  } finally { h.done(); }
});

test("el valor se recorta (un pegado con espacios o salto final es válido) y se lee tal cual, sin comillas ni comentarios", async () => {
  const h = home();
  try {
    await saveKiokuSecret("deepseek", `  sk-con "comillas" y # almohadilla \n`, h.o);
    assert.deepEqual(await resolveProviderSecrets({ provider: "deepseek" }, h.o), { DEEPSEEK_API_KEY: `sk-con "comillas" y # almohadilla` });
  } finally { h.done(); }
});

test("valor inválido (vacío, salto de línea interno, NUL, demasiado largo, no texto): ModelConfigError sin eco y sin tocar el disco", async () => {
  const h = home();
  try {
    for (const v of ["", "   ", `${SECRET}\nOTRA=x`, `${SECRET}\r`.repeat(2), `a\0${SECRET}`, `${SECRET}\u2028x`, `${SECRET}\u2029x`, SECRET.repeat(200), 5, null, undefined, { v: SECRET }]) {
      await assert.rejects(saveKiokuSecret("openrouter", v, h.o), (e: Error) => {
        assert.ok(e instanceof ModelConfigError);
        assert.ok(!e.message.includes(SECRET) && !e.message.includes("OTRA"), e.message);
        return true;
      });
    }
    assert.equal(existsSync(h.file), false);
    await saveKiokuSecret("openrouter", "a".repeat(4096), h.o); // el límite exacto sí cabe
  } finally { h.done(); }
});

test("lista blanca: solo proveedores con variable de clave; el nombre nunca viene del cliente", async () => {
  const h = home();
  try {
    for (const p of ["openai-codex", "nope", "", "../../etc/passwd", "__proto__", "constructor", SECRET, 7, null, undefined, "PATH"]) {
      await assert.rejects(saveKiokuSecret(p, SECRET, h.o), (e: Error) => {
        assert.ok(e instanceof ModelConfigError);
        assert.ok(!e.message.includes(SECRET), e.message);
        return true;
      });
      await assert.rejects(removeKiokuSecret(p, h.o), ModelConfigError);
    }
    assert.equal(existsSync(h.file), false);
    // Todas las variables que se escriben están en la lista de los proveedores.
    for (const [p, v] of [["custom", "OPENAI_API_KEY"], ["zai", "GLM_API_KEY"], ["ollama-launch", "OLLAMA_API_KEY"], ["kimi-coding", "KIMI_API_KEY"], ["minimax", "MINIMAX_API_KEY"]] as const) {
      await saveKiokuSecret(p, "k-" + p, h.o);
      assert.match(readFileSync(h.file, "utf8"), new RegExp(`^${v}=k-${p}$`, "m"));
    }
  } finally { h.done(); }
});

test("prioridad: Kioku → ~/.hermes/.env → entorno; el estado indica la fuente y nunca el valor", async () => {
  const h = home();
  try {
    writeFileSync(path.join(h.userHome, ".hermes/.env"), "OPENROUTER_API_KEY=de-hermes\n");
    const o = { userHome: h.userHome, env: { OPENROUTER_API_KEY: "del-entorno", ANTHROPIC_API_KEY: "ant-env" } as NodeJS.ProcessEnv };
    const s = { provider: "openrouter" } as const;
    assert.equal((await describeCredentials(s, o)).source, "hermes-env");
    await saveKiokuSecret("openrouter", SECRET, o);
    assert.deepEqual(await describeCredentials(s, o), { required: true, names: ["OPENROUTER_API_KEY"], state: "found", name: "OPENROUTER_API_KEY", source: "kioku" });
    assert.deepEqual(await resolveProviderSecrets(s, o), { OPENROUTER_API_KEY: SECRET });
    assert.ok(!JSON.stringify(await describeCredentials(s, o)).includes(SECRET));
    // Sin clave de Kioku en otro proveedor, sigue mandando el entorno.
    assert.equal((await describeCredentials({ provider: "anthropic" }, o)).source, "environment");
    // Una variable de Kioku vacía no tapa a las demás fuentes.
    writeFileSync(h.file, "OPENROUTER_API_KEY=\n");
    assert.equal((await describeCredentials(s, o)).source, "hermes-env");
  } finally { h.done(); }
});

test("sin reiniciar: la clave guardada o borrada se usa en la siguiente resolución (nada se cachea)", async () => {
  const h = home();
  try {
    const s = { provider: "opencode-go", model: "m" } as const;
    await assert.rejects(resolveProviderSecrets(s, h.o), /OPENCODE_GO_API_KEY/);
    await saveKiokuSecret("opencode-go", "k1", h.o);
    assert.deepEqual(await resolveProviderSecrets(s, h.o), { OPENCODE_GO_API_KEY: "k1" });
    await saveKiokuSecret("opencode-go", "k2", h.o);
    assert.deepEqual(await resolveProviderSecrets(s, h.o), { OPENCODE_GO_API_KEY: "k2" });
    await removeKiokuSecret("opencode-go", h.o);
    await assert.rejects(resolveProviderSecrets(s, h.o), /OPENCODE_GO_API_KEY/);
  } finally { h.done(); }
});

test("borrar: quita solo su variable y conserva el resto; si no queda ninguna, elimina el fichero; sin fichero no falla", async () => {
  const h = home();
  try {
    await removeKiokuSecret("openrouter", h.o); // idempotente
    mkdirSync(path.dirname(h.file), { recursive: true });
    writeFileSync(h.file, "# nota\nANTHROPIC_API_KEY=ant-1\nOPENROUTER_API_KEY=x\n");
    await removeKiokuSecret("openrouter", h.o);
    assert.equal(readFileSync(h.file, "utf8"), "# nota\nANTHROPIC_API_KEY=ant-1\n");
    assert.equal(mode(h.file), 0o600);
    await removeKiokuSecret("anthropic", h.o);
    assert.equal(existsSync(h.file), false, "sin claves, no se deja un fichero vacío");
    await removeKiokuSecret("anthropic", h.o);
  } finally { h.done(); }
});

test("escrituras concurrentes: no se pierde ninguna variable", async () => {
  const h = home();
  try {
    await Promise.all(["openrouter", "anthropic", "deepseek", "minimax", "gemini"].map((p) => saveKiokuSecret(p, "k-" + p, h.o)));
    const text = readFileSync(h.file, "utf8");
    for (const n of ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_API_KEY", "GOOGLE_API_KEY"]) assert.match(text, new RegExp(`^${n}=k-`, "m"));
    assert.deepEqual(readdirSync(path.dirname(h.file)), ["credentials.env"]);
  } finally { h.done(); }
});

test("el fichero no es normal (enlace o carpeta): se rechaza sin seguirlo ni sobrescribirlo", async () => {
  const h = home();
  try {
    const target = path.join(h.root, "ajeno.txt");
    writeFileSync(target, "intacto\n");
    mkdirSync(path.dirname(h.file), { recursive: true });
    symlinkSync(target, h.file);
    await assert.rejects(saveKiokuSecret("openrouter", SECRET, h.o), (e: Error) => e instanceof ModelConfigError && !e.message.includes(SECRET));
    await assert.rejects(removeKiokuSecret("openrouter", h.o), ModelConfigError);
    assert.equal(readFileSync(target, "utf8"), "intacto\n");
    // Un enlace tampoco se lee como fuente de claves.
    writeFileSync(target, `OPENROUTER_API_KEY=${SECRET}\n`);
    await assert.rejects(resolveProviderSecrets({ provider: "openrouter" }, h.o), /OPENROUTER_API_KEY/);
  } finally { h.done(); }
});

test("mensajes de error: mencionan la configuración del asistente además de ~/.hermes/.env, sin repetir valores", async () => {
  const h = home();
  try {
    await assert.rejects(resolveProviderSecrets({ provider: "openrouter" }, h.o), (e: Error) => /Gestión del asistente/.test(e.message) && /\.hermes\/\.env/.test(e.message) && /OPENROUTER_API_KEY/.test(e.message));
    await assert.rejects(resolveProviderSecrets({ provider: "openrouter" }, { ...h.o, env: { OPENROUTER_API_KEY: `${SECRET}\nx` } }), (e: Error) => /Gestión del asistente/.test(e.message) && !e.message.includes(SECRET));
  } finally { h.done(); }
});
