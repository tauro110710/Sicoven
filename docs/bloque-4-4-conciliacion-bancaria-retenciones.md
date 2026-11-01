# Bloque 4.4 - Conciliacion fiscal bancaria IVA

Los nuevos eventos PAYMENT deben vincular uno o varios movimientos DEBIT importados, de la empresa y cuenta bancaria en Bs. La suma debe coincidir al centimo con el importe del enteramiento. Los movimientos deben tener fecha entre la presentacion y el pago y no pueden reutilizarse en otro evento.

Los pagos historicos sin vinculo se conservan como pendientes; no se inventan asociaciones. Los eventos son append-only y la auditoria SQLite registra los IDs bancarios asociados. La conciliacion no crea asientos ni modifica la conciliacion bancaria contable.

El vinculo no autentica extractos directamente con el banco ni confirma la recepcion del pago por SENIAT. No implica homologacion del TXT ni presentacion automatica.
