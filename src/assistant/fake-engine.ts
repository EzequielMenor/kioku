// Motor de pruebas locales (KIOKU_ASSISTANT_FAKE=1): sin Hermes ni red. Sirve para ver la UI y probar el flujo.
import type { AssistantEngine } from "./engine.ts";

export class FakeEngine implements AssistantEngine {
  async available(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async ask(i: Parameters<AssistantEngine["ask"]>[0]): Promise<{ answer: string }> {
    const tool = async (name: string, args: unknown = {}) => {
      const r = await fetch(`${i.daemonUrl}/api/assistant/tools/call`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${i.session.token}` }, body: JSON.stringify({ name, args }),
      });
      return (await r.json()) as { text: string; isError?: boolean; undoId?: string };
    };
    const pause = () => new Promise((r) => setTimeout(r, 700));
    await pause();
    const inbox = JSON.parse((await tool("inbox")).text) as { path: string; title: string }[];
    await pause();
    if (/tarea/i.test(i.message)) {
      const r = await tool("create_task", { title: i.message.replace(/.*tarea:?\s*/i, "").slice(0, 80) || "Tarea del asistente" });
      return { answer: r.isError ? `No pude crear la tarea: ${r.text}` : "He creado la tarea. Si no era lo que querías, pulsa Deshacer." };
    }
    if (/borra|elimina/i.test(i.message) && inbox[0]) {
      await tool("propose", { title: `Descartar «${inbox[0].title}»`, rationale: "Lo has pedido en el chat", ops: [{ op: "trash", path: inbox[0].path }] });
      return { answer: "Borrar siempre necesita tu aprobación: he dejado una propuesta en Propuestas." };
    }
    return { answer: inbox.length ? `Tienes ${inbox.length} capturas en la Bandeja:\n${inbox.map((c) => `· ${c.title}`).join("\n")}` : "La Bandeja está vacía." };
  }
}
