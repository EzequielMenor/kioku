// macOS: Hermes completo dentro de Docker, no solo su herramienta de terminal.
// No se monta el vault, el HOME, el socket Docker ni configuraciones globales.
import path from "node:path";

export const DOCKER_IMAGE = "nousresearch/hermes-agent:stable";
export const DOCKER_HERMES_HOME = "/opt/data";
export const DOCKER_BRIDGE = "/opt/kioku-mcp.mjs";

function mountPath(value: string): string {
  if (!path.isAbsolute(value) || path.normalize(value) === "/" || /[,\r\n\0]/.test(value)) {
    throw new Error("Ruta de montaje Docker no válida (absoluta, sin comas ni saltos de línea)");
  }
  return value;
}

export function buildDockerArgs(o: {
  hermesDir: string; bridgePath: string; image: string; name: string; cidFile: string;
  uid: number; gid: number; args: string[]; realAuth?: string; authLock?: string; secretNames?: string[];
}): string[] {
  if (o.image.includes("://") || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(o.image)) throw new Error("Imagen Docker no válida");
  if (!/^kioku-hermes-[a-zA-Z0-9-]+$/.test(o.name)) throw new Error("Nombre del contenedor no válido");
  if (![o.uid, o.gid].every(x => Number.isSafeInteger(x) && x > 0)) throw new Error("Docker requiere un usuario no root");
  for (const name of o.secretNames ?? []) if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("Variable de proveedor no válida");
  const bind = (source: string, target: string, readOnly = false) => ["--mount", `type=bind,source=${mountPath(source)},target=${target}${readOnly ? ",readonly" : ""}`];
  return [
    "run", "--pull=never", "--name", o.name, "--cidfile", mountPath(o.cidFile),
    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=128",
    "--user", `${o.uid}:${o.gid}`, "--network", "host",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=128m", "--workdir", DOCKER_HERMES_HOME,
    ...bind(o.hermesDir, DOCKER_HERMES_HOME), ...bind(o.bridgePath, DOCKER_BRIDGE, true),
    ...(o.realAuth ? bind(o.realAuth, `${DOCKER_HERMES_HOME}/auth.json`) : []),
    ...(o.authLock ? bind(o.authLock, `${DOCKER_HERMES_HOME}/auth.lock`) : []),
    "--env", `HERMES_HOME=${DOCKER_HERMES_HOME}`, "--env", `HOME=${DOCKER_HERMES_HOME}`,
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    ...(o.secretNames ?? []).flatMap(name => ["--env", name]),
    // La imagen oficial contiene Python y Node; no se ejecuta su init/gateway ni se publica ningún puerto.
    "--entrypoint", "/opt/hermes/.venv/bin/hermes", o.image, ...o.args,
  ];
}
