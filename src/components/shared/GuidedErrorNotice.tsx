import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { classifyGuidedEntryError } from '../../types/guidedEntryErrors';

interface GuidedErrorNoticeProps {
  /** Operación que falló, p. ej. «No se pudo registrar la compra». */
  title: string;
  /** Mensaje original del validador; no se reescribe. */
  message: string;
  onDismiss?: () => void;
  /** Para hacer scroll hasta el aviso cuando el error ocurre al pie del formulario. */
  noticeRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  /**
   * Presenta el aviso como diálogo modal sobre el formulario abierto, en lugar
   * de una franja dentro del formulario. Nunca cierra ni recarga la pantalla:
   * al cerrarlo, los datos cargados siguen intactos.
   */
  asDialog?: boolean;
}

/**
 * Aviso guiado reutilizable para compras, ventas, notas e importaciones.
 * Mantiene el formulario en pantalla: nunca cierra el modal ni recarga.
 */
export const GuidedErrorNotice: React.FC<GuidedErrorNoticeProps> = ({
  title,
  message,
  onDismiss,
  noticeRef,
  className = '',
  asDialog = false
}) => {
  const { field, hint } = classifyGuidedEntryError(message);
  const body = (
    <div
      ref={noticeRef}
      role="alertdialog"
      aria-modal={asDialog || undefined}
      aria-live="assertive"
      className={`rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-950 shadow-sm ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-700" />
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 text-sm leading-relaxed">{message}</p>
          <p className="mt-2 text-xs font-medium text-rose-800">{hint}</p>
          <p className="mt-2 text-[11px] text-rose-700/80">
            La compra no se guardó. Los datos que cargaste siguen en el formulario: corrige lo indicado y vuelve a guardar.
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md p-1 text-rose-700 hover:bg-rose-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {asDialog && onDismiss && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-bold text-white hover:bg-rose-800"
          >
            Revisar y corregir
          </button>
        </div>
      )}
    </div>
  );

  if (!asDialog) return body;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl">{body}</div>
    </div>
  );
};
