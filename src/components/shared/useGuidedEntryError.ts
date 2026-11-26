import { useCallback, useRef, useState } from 'react';
import { classifyGuidedEntryError, type GuidedEntryField } from '../../types/guidedEntryErrors';

/**
 * Estado y helpers compartidos para el aviso guiado de formularios de entrada.
 * Mantiene un solo mensaje: el clasificador decide qué campo resaltar.
 */
export function useGuidedEntryError() {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const errorField = submitError ? classifyGuidedEntryError(submitError).field : null;

  const showGuidedError = useCallback((message: string) => {
    setSubmitError(message);
    window.requestAnimationFrame(() => noticeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, []);

  const clearError = useCallback(() => setSubmitError(null), []);

  const fieldTone = (field: GuidedEntryField) =>
    errorField === field
      ? 'border-rose-400 bg-rose-50 text-rose-900 focus:ring-rose-500'
      : 'border border-slate-300 focus:ring-emerald-500';

  // Editar cualquier campo descarta el aviso: ya no describe lo que hay en pantalla.
  const editText =
    (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setter(event.target.value);
      setSubmitError(null);
    };

  return { submitError, errorField, noticeRef, showGuidedError, clearError, fieldTone, editText };
}
