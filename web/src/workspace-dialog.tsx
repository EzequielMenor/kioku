import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** El diálogo nativo contiene el foco y mantiene inactiva la página mientras se escribe. */
export function WorkspaceDialog({ label, className, onClose, children }: {
  label: string; className: string; onClose(): void; children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} class={`modal workspace-dialog ${className}`} aria-label={label}
      onKeyDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        const { left, right, top, bottom } = e.currentTarget.getBoundingClientRect();
        if (e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom) onClose();
      }}>
      {children}
    </dialog>
  );
}
