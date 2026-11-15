import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { assistantModelCommand, DEFAULT_OLLAMA_MODEL } from "../src/cli/assistant-model.ts";
import { tmpVault } from "./helpers.ts";

test("kioku assistant model ollama: por defecto qwen3.5:9b en el Ollama local, con el override de la interfaz", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const r = await assistantModelCommand(root, ["ollama"], root);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.equal(DEFAULT_OLLAMA_MODEL, "qwen3.5:9b");
    assert.match(r.lines[0], /ollama · qwen3\.5:9b/);
    const saved = JSON.parse(readFileSync(path.join(root, ".kioku", "assistant-model.json"), "utf8"));
    assert.equal(saved.model.provider, "ollama");
    assert.equal(saved.model.default, "qwen3.5:9b");
    assert.equal(saved.model.base_url, "http://localhost:11434/v1");
    assert.equal(saved.managed_by, "kioku-ui");
    const other = await assistantModelCommand(root, ["ollama", "qwen3:8b", "--base-url", "http://100.100.1.2:11434/v1"], root);
    assert.equal(other.code, 0, other.lines.join("\n"));
    assert.match(other.lines[0], /qwen3:8b · http:\/\/100\.100\.1\.2:11434/);
    assert.equal((await assistantModelCommand(root, ["reset"], root)).code, 0);
  } finally { cleanup(); }
});

test("kioku assistant model: rechaza destinos inseguros y no pisa un override ajeno", async () => {
  const { root, cleanup } = tmpVault();
  try {
    const bad = await assistantModelCommand(root, ["ollama", "qwen3.5:9b", "--base-url", "http://example.com:11434/v1"], root);
    assert.equal(bad.code, 1);
    assert.match(bad.lines[0], /https/);
    mkdirSync(path.join(root, ".kioku"), { recursive: true });
    writeFileSync(path.join(root, ".kioku", "assistant-model.json"), "{\"provider\":\"anthropic\"}");
    const foreign = await assistantModelCommand(root, ["ollama"], root);
    assert.equal(foreign.code, 1);
    assert.match(foreign.lines[0], /no lo creó la interfaz/i);
    assert.equal((await assistantModelCommand(root, ["nada"], root)).code, 1);
  } finally { cleanup(); }
});
