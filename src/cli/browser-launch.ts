// En macOS se usa el navegador predeterminado. La rama Linux es perezosa:
// no busca binarios Linux ni crea perfiles en ~/.cache cuando se ejecuta en Mac.
export function browserLaunch(url: string, linux: () => { bin: string; args: string[] }, platform: NodeJS.Platform = process.platform): { bin: string; args: string[] } {
  return platform === "darwin" ? { bin: "/usr/bin/open", args: [url] } : linux();
}
