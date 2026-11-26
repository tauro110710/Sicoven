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
  className = ''
}) => {
  const { field, hint } = classifyGuidedEntryError(message);
  return (
    <div
      ref={noticeRef}
      role="alertdialog"
      aria-live="assertive"
      className={`rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-950 shadow-sm ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-700" />
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 text-sm leading-relaxed">{message}</p>
          <p className="mt-2 text-xs font-medium text-rose-800">{hint}</p>
          {field === 'taxRate' && (
            <p className="mt-1 text-[11px] text-rose-700/80">El campo de alícuota quedó resaltado con los datos cargados.</p>
          )}
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
    </div>
  );
};
