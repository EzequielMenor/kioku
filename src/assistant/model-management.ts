// Gestión del modelo desde la interfaz de escritorio: lee el estado real y guarda/restablece el override
// `.kioku/assistant-model.json`. Nunca toca `assistant.json` (exclusiones) ni acepta claves; las credenciales
// solo se describen (nombre de la variable y de dónde sale), jamás se devuelven.
import { promises as fs } from "node:fs";
import path from "node:path";
import { Vault } from "../core/vault.ts";
import {
  MODEL_OVERRIDE_FILE, MODEL_OVERRIDE_OWNER, ModelConfigError, apiModes, checkModelOverride, describeCredentials, describeProviders, readModelOverride,
  rejectFields, resolveModel, serializeModelOverride,
  type CredentialStatus, type ModelSource, type ProviderInfo,
} from "./model-config.ts";

/** Conflicto con lo que hay en disco (p. ej. un fichero que no creó la interfaz): se explica, no se pisa. */
export class ModelManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelManagementError";
  }
}

export type OverrideView =
  | { state: "none" }
  | { state: "ui"; provider: string; model: string | null; baseUrl: string | null; apiMode: string | null; acknowledgedOrigin: string | null }
  | { state: "invalid"; error: string };

export interface ModelState {
  providers: ProviderInfo[];
  apiModes: string[];
  override: OverrideView;
  /** Lo que usará Hermes ahora mismo. Del destino solo el origen (esquema + host), nunca la ruta completa. */
  effective: { provider: string; model: string | null; baseOrigin: string | null; apiMode: string | null; source: ModelSource } | null;
  error: string | null;
  credentials: CredentialStatus | null;
}

const INPUT_FIELDS = ["provider", "model", "base_url", "api_mode", "confirm_origin"];
const MAX_FILE = 256 * 1024;
const WHERE = "Modelo del asistente";

/** Campo opcional de texto: vacío o `null` = ausente; cualquier otro tipo se rechaza sin repetirlo. */
function optionalText(o: Record<string, unknown>, field: string): string | undefined {
  const v = o[field];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ModelConfigError(`${WHERE}: «${field}» debe ser texto`);
  return v;
}

export class ModelManagement {
  private o: { homeDir: string; userHome: () => string; env?: NodeJS.ProcessEnv };
  private vault: Vault;
  private file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(o: { homeDir: string; userHome: () => string; env?: NodeJS.ProcessEnv }) {
    this.o = o;
    this.vault = new Vault(o.homeDir);
    this.file = path.join(o.homeDir, ".kioku", MODEL_OVERRIDE_FILE);
  }

  async state(): Promise<ModelState> {
    const userHome = this.o.userHome();
    const base = { providers: describeProviders(), apiModes: apiModes() };
    let override: OverrideView = { state: "none" };
    try {
      const ov = await readModelOverride(this.o.homeDir);
      if (ov) override = { state: "ui", provider: ov.provider, model: ov.model ?? null, baseUrl: ov.baseUrl ?? null, apiMode: ov.apiMode ?? null, acknowledgedOrigin: ov.acknowledgedOrigin ?? null };
    } catch (e) {
      if (!(e instanceof ModelConfigError)) throw e;
      override = { state: "invalid", error: e.message };
    }
    try {
      const { settings, source } = await resolveModel({ homeDir: this.o.homeDir, userHome });
      return {
        ...base, override, error: null, credentials: await describeCredentials(settings, { userHome, env: this.o.env }),
        effective: { provider: settings.provider, model: settings.model ?? null, baseOrigin: settings.baseUrl ? new URL(settings.baseUrl).origin : null, apiMode: settings.apiMode ?? null, source },
      };
    } catch (e) {
      if (!(e instanceof ModelConfigError)) throw e;
      return { ...base, override, effective: null, error: e.message, credentials: null };
    }
  }

  /** Valida TODO antes de escribir: una entrada inválida no deja rastro. */
  async save(input: unknown): Promise<ModelState> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ModelConfigError(`${WHERE}: se esperaba un objeto con provider, model, base_url, api_mode`);
    const body = input as Record<string, unknown>;
    rejectFields(body, INPUT_FIELDS, WHERE);
    const checked = checkModelOverride(
      { provider: body.provider, model: optionalText(body, "model"), base_url: optionalText(body, "base_url"), api_mode: optionalText(body, "api_mode") },
      optionalText(body, "confirm_origin"), WHERE, "confirm_origin",
    );
    return this.exclusive(async () => {
      if ((await this.ownership()) === "foreign") throw this.foreign();
      await this.vault.writeInternal(MODEL_OVERRIDE_FILE, serializeModelOverride(checked));
      return this.state();
    });
  }

  /** «Heredar»: quita el override, y solo si es un fichero que creó la interfaz. */
  async reset(): Promise<ModelState> {
    return this.exclusive(async () => {
      const own = await this.ownership();
      if (own === "foreign") throw this.foreign();
      if (own === "ui") await this.vault.removeInternal(MODEL_OVERRIDE_FILE);
      return this.state();
    });
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private foreign(): ModelManagementError {
    return new ModelManagementError(`Ya existe .kioku/${MODEL_OVERRIDE_FILE} y no lo creó la interfaz de Kioku: revísalo o bórralo a mano; no lo toco`);
  }

  /** Prueba de propiedad: fichero normal con la marca de la interfaz. Cualquier otra cosa se trata como ajena. */
  private async ownership(): Promise<"none" | "ui" | "foreign"> {
    try {
      const st = await fs.lstat(this.file);
      if (!st.isFile() || st.size > MAX_FILE) return "foreign";
      const json = JSON.parse(await fs.readFile(this.file, "utf8"));
      return json && typeof json === "object" && !Array.isArray(json) && json.managed_by === MODEL_OVERRIDE_OWNER ? "ui" : "foreign";
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "ENOENT" ? "none" : "foreign";
    }
  }
}
