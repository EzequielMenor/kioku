// Motor de pruebas locales (KIOKU_ASSISTANT_FAKE=1): sin Hermes ni red. Sirve para ver la UI y probar el flujo,
// incluidos los estados del compañero: piensa, usa herramientas, responde por fragmentos, propone o falla.
import type { AskInput, AssistantEngine, EngineInfo } from "./engine.ts";

export class FakeEngine implements AssistantEngine {
  readonly isolatesMobile = false;

  async available(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async describe(): Promise<EngineInfo> {
    return { engine: "fake", provider: "demo", model: "motor de pruebas", origin: null, local: true };
  }

  async ask(i: AskInput): Promise<{ answer: string }> {
    const tool = async (name: string, args: unknown = {}) => {
      const r = await fetch(`${i.daemonUrl}/api/assistant/tools/call`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${i.session.token}` }, body: JSON.stringify({ name, args }),
      });
      return (await r.json()) as { text: string; isError?: boolean; undoId?: string };
    };
    const pause = (ms = 700) => new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      i.signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Consulta cancelada.")); }, { once: true });
    });
    /** Entrega la respuesta por fragmentos, como un modelo en streaming. */
    const say = async (answer: string) => {
      for (const word of answer.split(/(?<=\s)/)) { i.onEvent?.({ type: "delta", text: word }); await pause(35); }
      return { answer };
    };
    i.onEvent?.({ type: "thinking" });
    await pause();
    if (/\b(falla|error)\b/i.test(i.message)) throw new Error("El modelo de pruebas ha fallado a propósito.");
    const inbox = JSON.parse((await tool("inbox")).text) as { path: string; title: string }[];
    await pause();
    if (/tarea/i.test(i.message)) {
      const r = await tool("create_task", { title: i.message.replace(/.*tarea:?\s*/i, "").slice(0, 80) || "Tarea del asistente" });
      return say(r.isError ? `No pude crear la tarea: ${r.text}` : "He creado la tarea. Si no era lo que querías, pulsa Deshacer.");
    }
    if (/borra|elimina/i.test(i.message) && inbox[0]) {
      await tool("propose", { title: `Descartar «${inbox[0].title}»`, rationale: "Lo has pedido en el chat", ops: [{ op: "trash", path: inbox[0].path }] });
      return say("Borrar siempre necesita tu aprobación: he dejado una propuesta para que la confirmes.");
    }
    if (i.context && /\besto\b|esta nota|qu[eé] veo/i.test(i.message)) return say(`Veo esto: ${i.context.replace(/^\[[^\]]*\]\s*/, "")}`);
    return say(inbox.length ? `Tienes ${inbox.length} capturas en la Bandeja:\n${inbox.map((c) => `· ${c.title}`).join("\n")}` : "La Bandeja está vacía.");
  }
}
