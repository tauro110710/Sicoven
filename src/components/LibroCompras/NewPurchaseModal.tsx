import React, { useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { ShoppingCart, X, Check, Calculator, ShieldCheck } from 'lucide-react';
import { ISLR_CONCEPTS, calculateMonthlyIslrRetention, getIslrUnitTaxValueForPeriod, ISLR_FORMULA_FACTOR } from '../../data/islrConcepts';
import { formatBs, formatUsd, cleanRif, formatRif } from '../../utils/formatters';
import { calculatePurchaseIgtf, type PurchasePaymentMethod } from '../../types/purchaseTaxes';
import { getPurchaseAccountCreditDate, getCompanyTaxStatusForDate, type PurchaseIvaRetentionSnapshot } from '../../types/accounting';
import { evaluateIvaRetentionEligibility, resolveIvaBuyerAgentStatus, type IvaArticle3Exclusion, type IvaSupplierTaxStatus } from '../../types/ivaRetentionEligibility';
import { getCompanyPurchasePaymentAccounts } from '../../types/purchaseAccounting';
import { getBolivarScaleMetadataByDate, getVenezuelanMonetaryEra } from '../../types/historicalAccountingCalendar';

interface NewPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({ isOpen, onClose }) => {
  const { currentCompany, accounts, bankAccounts, products, movements, purchases, addPurchase, addMovement, runAtomicInvoiceImport, waitForPersistence } = useAccounting();
  const savingRef = React.useRef(false);
  const [saving, setSaving] = useState(false);

  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [accountCreditDate, setAccountCreditDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [supplierRif, setSupplierRif] = useState<string>('J-');
  const [supplierName, setSupplierName] = useState<string>('');
  const [supplierAddress, setSupplierAddress] = useState<string>('');
  const [supplierEmail, setSupplierEmail] = useState<string>('');
  const [supplierTaxStatus, setSupplierTaxStatus] = useState<'AUTO' | IvaSupplierTaxStatus>('AUTO');
  const [article3Exclusion, setArticle3Exclusion] = useState<IvaArticle3Exclusion | ''>('');
  const [portalArticle3ExclusionConfirmed, setPortalArticle3ExclusionConfirmed] = useState(false);
  const [supplierImportPerceptionConfirmed, setSupplierImportPerceptionConfirmed] = useState(false);
  const [article2Transaction, setArticle2Transaction] = useState(false);
  const [invoiceFormalDefect, setInvoiceFormalDefect] = useState(false);
  const [vatNotDiscriminated, setVatNotDiscriminated] = useState(false);
  const [taxableGrossInput, setTaxableGrossInput] = useState('');
  const taxableGrossBs = parseDecimalInput(taxableGrossInput);
  const [portalRetentionRate, setPortalRetentionRate] = useState<'' | '75' | '100'>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [controlNumber, setControlNumber] = useState<string>('');
  const [documentType, setDocumentType] = useState<'01' | '02' | '03'>('01');
  const [affectedInvoiceNumber, setAffectedInvoiceNumber] = useState<string>('');

  // Amounts
  const [taxableBaseInput, setTaxableBaseInput] = useState('');
  const taxableBaseBs = parseDecimalInput(taxableBaseInput);
  const [exemptAmountInput, setExemptAmountInput] = useState('');
  const exemptAmountBs = parseDecimalInput(exemptAmountInput);
  const [taxRate, setTaxRate] = useState<number>(16);
  const [vatCreditTreatment, setVatCreditTreatment] = useState<'TAXABLE' | 'EXEMPT' | 'COMMON'>('COMMON');

  // IVA Withholding: tasa determinada por Providencia 000054.

  // ISLR Withholding
  const [applyIslr, setApplyIslr] = useState<boolean>(false);
  const [islrConceptCode, setIslrConceptCode] = useState<string>('');

  // Currency
  const [bcvRateInput, setBcvRateInput] = useState('');
  const bcvRate = parseDecimalInput(bcvRateInput);
  const [notes, setNotes] = useState<string>('');
  // Clasificación explícita: mercancía al Kardex o cuenta específica de gasto/activo.
  const [linkInventory, setLinkInventory] = useState(true);
  const [purchaseDebitAccountCode, setPurchaseDebitAccountCode] = useState('');
  const nonInventoryDebitAccounts = accounts.filter(account => account.isMovement && (account.type === 'GASTOS' || account.type === 'COSTOS' || (account.type === 'ACTIVO' && account.code.startsWith('1.2.')))).sort((x,y)=>x.code.localeCompare(y.code,undefined,{numeric:true}));
  const [inventoryLines, setInventoryLines] = useState<Array<{productId:string; quantity:string; unitCostBs:string}>>([{productId:'',quantity:'1',unitCostBs:''}]);
  const [paymentTerm, setPaymentTerm] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [paymentAccountCode, setPaymentAccountCode] = useState<string>('');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const paymentAccounts = getCompanyPurchasePaymentAccounts(accounts, bankAccounts, currentCompany.id).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const [creditDays, setCreditDays] = useState<number>(7);
  const [currencyPricingMode, setCurrencyPricingMode] = useState<'USD_FIJO' | 'BS_AJUSTABLE' | 'REVISION_MANUAL'>('USD_FIJO');
  const [fiscalAdjustmentMode, setFiscalAdjustmentMode] = useState<'IVA_ORIGINAL_DIF_CAMBIARIA' | 'AJUSTE_BASE_IVA' | 'REVISION_CONTADOR'>('REVISION_CONTADOR');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('BS');
  const [applyIgtf, setApplyIgtf] = useState(false);
  const dueDate = (() => { const d = new Date(invoiceDate + 'T12:00:00'); d.setDate(d.getDate() + creditDays); return d.toISOString().slice(0, 10); })();

  if (!isOpen) return null;

  function parseDecimalInput(value: string) { const raw = value.trim(); if (!raw) return 0; return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw); }
  function parseBolivarInput(value: string, date: string) { const raw = value.trim(); if (!raw) return 0; const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw; const era = getVenezuelanMonetaryEra(date); return Number(convertVenezuelanAmount(normalized, era.id, 'BOLIVAR_DIGITAL')); }
  const monetaryScaleSnapshot = getBolivarScaleMetadataByDate(invoiceDate);
  const rateScaleSnapshot = getBolivarScaleMetadataByDate(accountCreditDate || invoiceDate);


  // Real-time calculations
  const effectiveTaxableBaseBs = vatNotDiscriminated && taxRate > 0 ? Math.round((taxableGrossBs / (1 + taxRate / 100) + Number.EPSILON) * 100) / 100 : taxableBaseBs;
  const effectiveVatRate = taxRate === 31 ? 16 : taxRate;
  const vatAmountBs = Math.round(effectiveTaxableBaseBs * (effectiveVatRate / 100) * 100) / 100;
  const additionalLuxuryTaxBs = taxRate === 31 ? Math.round(effectiveTaxableBaseBs * 0.15 * 100) / 100 : 0;
  const selectedMonthKey = String(accountCreditDate || invoiceDate || '').slice(0, 7);
  const islrUnitTaxValueBs = getIslrUnitTaxValueForPeriod(selectedMonthKey);
  const operationAmountBs = Math.round((effectiveTaxableBaseBs + exemptAmountBs + vatAmountBs + additionalLuxuryTaxBs + Number.EPSILON) * 100) / 100;
  const supplierRifKeyForProfile = String(supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const supplierProfilePurchase = purchases.filter(item => item.companyId === currentCompany.id && String(item.supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === supplierRifKeyForProfile && item.supplierTaxStatus).sort((a, b) => b.opNumber - a.opNumber)[0];
  const resolvedSupplierTaxStatus: IvaSupplierTaxStatus = supplierTaxStatus === 'AUTO' ? (supplierProfilePurchase?.supplierTaxStatus || 'UNKNOWN') : supplierTaxStatus;
  const effectiveCompanyTaxStatus = getCompanyTaxStatusForDate(currentCompany, accountCreditDate || invoiceDate);
  const hasTaxStatusHistory = (currentCompany.taxStatusHistory || []).length > 0;
  const buyerAgentStatus = resolveIvaBuyerAgentStatus({
    agentBasis: effectiveCompanyTaxStatus?.ivaRetentionAgentBasis ?? (hasTaxStatusHistory ? 'UNCONFIRMED' : currentCompany.ivaRetentionAgentBasis),
    taxpayerType: effectiveCompanyTaxStatus
      ? (effectiveCompanyTaxStatus.specialTaxpayerStatus === 'ESPECIAL'
        ? 'ESPECIAL'
        : effectiveCompanyTaxStatus.specialTaxpayerStatus === 'NO_ESPECIAL' ? 'ORDINARIO' : 'PENDIENTE')
      : (hasTaxStatusHistory ? 'PENDIENTE' : currentCompany.taxpayerType),
    rif: currentCompany.rif,
    isPersonalFirm: effectiveCompanyTaxStatus?.isPersonalFirm ?? (!hasTaxStatusHistory ? currentCompany.isPersonalFirm : false)
  });
  const ivaEligibility = evaluateIvaRetentionEligibility({ buyerAgentStatus, supplierTaxStatus: resolvedSupplierTaxStatus, article2Transaction, article3Exclusions: article3Exclusion ? [article3Exclusion] : [], portalArticle3ExclusionConfirmed, supplierImportPerceptionConfirmed, operationAmountBs, unitTaxValueBs: islrUnitTaxValueBs ?? undefined, vatAmount: vatAmountBs, ...(vatNotDiscriminated ? { vatNotDiscriminated: true, taxableAmountIncludingVat: taxableGrossBs } : {}), taxRate, invoiceFormalDefect, portalRetentionRate: portalRetentionRate === '' ? null : Number(portalRetentionRate) as 75 | 100 });
  const retentionRate = ivaEligibility.retentionRate;
  const invoiceSubtotalBs = operationAmountBs;
  const igtfCalculation = calculatePurchaseIgtf(invoiceSubtotalBs, paymentMethod, applyIgtf, 3, paymentTerm);
  const igtfApplicable = igtfCalculation.applicable;
  const igtfAmountBs = igtfCalculation.amountBs;
  const totalAmountBs = Math.round((invoiceSubtotalBs + igtfAmountBs) * 100) / 100;
  const vatWithheldBs = ivaEligibility.withheldAmount;

  // ISLR calculation
  const selectedConcept = ISLR_CONCEPTS.find(c => c.code === islrConceptCode);
  const normalizedSupplierRif = String(supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const hasCancelledPriorIslrOperation = Boolean(selectedConcept) && purchases.some(item =>
    item.companyId === currentCompany.id &&
    item.documentType === '01' &&
    item.isCancelled &&
    String(item.supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === normalizedSupplierRif &&
    item.islrConceptCode === selectedConcept?.code &&
    getPurchaseAccountCreditDate(item).slice(0, 7) === selectedMonthKey
  );
  const hasIncompletePriorIslrOperation = Boolean(selectedConcept) && purchases.some(item =>
    item.companyId === currentCompany.id &&
    item.documentType === '01' &&
    !item.isCancelled &&
    String(item.supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === normalizedSupplierRif &&
    item.islrConceptCode === selectedConcept?.code &&
    getPurchaseAccountCreditDate(item).slice(0, 7) === selectedMonthKey &&
    (item.islrUnitTaxValueBs == null || item.islrFormulaFactor == null ||
      item.islrBasePercentage == null || !Number.isFinite(Number(item.taxableBaseBs)) ||
      !Number.isFinite(Number(item.islrWithheldBs)) || !Number.isFinite(Number(item.islrSubtrahendBs)))
  );
  let islrWithheldBs = 0;
  let islrSubtrahendBs = 0;
  let islrRate = 0;

  if (applyIslr && selectedConcept && effectiveTaxableBaseBs > 0) {
    const supplierKey = String(supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const monthKey = String(accountCreditDate || '').slice(0, 7);
    const priorOperations = purchases.filter(item =>
      item.companyId === currentCompany.id &&
      !item.isCancelled &&
      item.documentType === '01' &&
      String(item.supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === supplierKey &&
      item.islrConceptCode === selectedConcept.code &&
      getPurchaseAccountCreditDate(item).slice(0, 7) === monthKey
    ).map(item => ({
      baseAmountBs: item.taxableBaseBs,
      withheldAmountBs: item.islrWithheldBs,
      subtrahendBs: item.islrSubtrahendBs
    }));
    if (islrUnitTaxValueBs != null) {
      const calc = calculateMonthlyIslrRetention(effectiveTaxableBaseBs, priorOperations, selectedConcept, islrUnitTaxValueBs);
      islrRate = calc.rate;
      islrSubtrahendBs = calc.subtrahendBs;
      islrWithheldBs = calc.withheldAmountBs;
    }
  }

  // Net payable
  const netPayableBs = totalAmountBs - vatWithheldBs - islrWithheldBs;

  // USD conversions
  const totalAmountUsd = bcvRate > 0 ? totalAmountBs / bcvRate : 0;
  const taxableBaseUsd = bcvRate > 0 ? effectiveTaxableBaseBs / bcvRate : 0;
  const vatAmountUsd = bcvRate > 0 ? vatAmountBs / bcvRate : 0;
  const vatWithheldUsd = bcvRate > 0 ? vatWithheldBs / bcvRate : 0;
  const islrWithheldUsd = bcvRate > 0 ? islrWithheldBs / bcvRate : 0;

  const inventoryLineTotal = inventoryLines.reduce((sum,line) => sum + Math.max(0,parseDecimalInput(line.quantity)||0) * Math.max(0,parseDecimalInput(line.unitCostBs)||0),0);
  const inventoryLinesValid = !linkInventory || (
    inventoryLines.length > 0 &&
    inventoryLines.every(line => products.some(p => p.id === line.productId && p.companyId === currentCompany.id) &&
      Number.isFinite(parseDecimalInput(line.quantity)) && parseDecimalInput(line.quantity) > 0 &&
      Number.isFinite(parseDecimalInput(line.unitCostBs)) && parseDecimalInput(line.unitCostBs) > 0) &&
    Math.abs(inventoryLineTotal - (effectiveTaxableBaseBs + exemptAmountBs)) <= 0.02 &&
    new Set(inventoryLines.map(line=>line.productId)).size === inventoryLines.length
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierRif.trim() || !supplierName.trim() || !invoiceNumber.trim()) {
      window.alert('Completa el RIF, nombre del proveedor y número de factura.');
      return;
    }
    if (applyIslr && !selectedConcept) {
      window.alert('Selecciona un concepto ISLR válido. No se aplicará una retención por defecto ni se inferirá la condición fiscal a partir del RIF.');
      return;
    }
    if (applyIslr && islrUnitTaxValueBs == null) {
      window.alert('No existe un valor de Unidad Tributaria verificado para el período seleccionado. No se puede calcular ni registrar esta retención ISLR.');
      return;
    }
    if (applyIslr && hasCancelledPriorIslrOperation) {
      window.alert('Existe una operación ISLR del mismo proveedor, concepto y mes que fue anulada y requiere rectificación fiscal. No se puede recalcular el acumulado hasta resolver esa corrección.');
      return;
    }
    if (applyIslr && hasIncompletePriorIslrOperation) {
      window.alert('El historial ISLR mensual contiene operaciones anteriores con parámetros o importes incompletos. Se requiere conciliación fiscal antes de acumular.');
      return;
    }
    if (!Number.isFinite(bcvRate) || bcvRate <= 0) {
      window.alert('No se puede registrar la compra sin una tasa BCV manual válida mayor que cero. Verifica la tasa de la empresa e inténtalo de nuevo.');
      return;
    }
    if (!Number.isFinite(totalAmountBs) || totalAmountBs <= 0) {
      window.alert('El total de la factura debe ser un importe válido mayor que cero.');
      return;
    }
    if (![effectiveTaxableBaseBs, exemptAmountBs, vatAmountBs, additionalLuxuryTaxBs, igtfAmountBs, vatWithheldBs, islrWithheldBs].every(value => Number.isFinite(value) && value >= 0)) {
      window.alert('Hay importes fiscales inválidos. Revisa base imponible, exento, IVA, IGTF y retenciones.');
      return;
    }
    if (!inventoryLinesValid) {
      window.alert('Las líneas deben usar artículos existentes, cantidades y costos válidos, sin repetir artículos, y conciliar con la base imponible más el monto exento.');
      return;
    }
    if (!linkInventory && !nonInventoryDebitAccounts.some(account => account.code === purchaseDebitAccountCode)) {
      window.alert('Clasifica la compra y selecciona expresamente una cuenta de gasto o de activo. No se utilizará Honorarios Profesionales ni otra cuenta por defecto.');
      return;
    }
    if (linkInventory) {
      for (const line of inventoryLines) {
        const product = products.find(p => p.id === line.productId && p.companyId === currentCompany.id);
        if (!product) { window.alert('Un artículo seleccionado ya no existe en la empresa activa.'); return; }
        const latest = movements.filter(m => m.companyId === currentCompany.id && m.productId === product.id)
          .reduce((value,m) => m.date > value ? m.date : value, '');
        if (latest && invoiceDate < latest) {
          window.alert('La fecha de compra es anterior al último movimiento del Kardex de ' + product.code + ' (' + latest + '). Registra los períodos en orden cronológico.');
          return;
        }
      }
    }
    if (paymentTerm === 'CONTADO') {
      if (!paymentAccounts.some(account => account.code === paymentAccountCode)) {
        window.alert('Selecciona una cuenta de movimiento de Caja o Banco del Plan de Cuentas.'); return;
      }
      if (!paymentReference.trim()) { window.alert('Indica el número de comprobante, referencia bancaria o soporte del desembolso.'); return; }
    }
    if (vatWithheldBs + islrWithheldBs > totalAmountBs + 0.005) {
      window.alert('Las retenciones no pueden superar el total de la factura.');
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      runAtomicInvoiceImport(() => {
      addPurchase({
      invoiceDate,
      accountCreditDate,
      monetaryScaleSnapshot,
      sourceMonetaryAmounts: { taxableBase: taxableBaseInput, exemptAmount: exemptAmountInput, taxableGross: taxableGrossInput, bcvRate: bcvRateInput, bcvRateScale: rateScaleSnapshot.label, inventoryUnitCosts: JSON.stringify(inventoryLines.map(line => ({ productId: line.productId, unitCost: line.unitCostBs }))) },
      supplierRif: formatRif(supplierRif),
      supplierName: supplierName.trim().toUpperCase(),
      supplierAddress: supplierAddress.trim() || undefined,
      supplierEmail: supplierEmail.trim() || undefined,
      invoiceNumber: invoiceNumber.trim(),
      controlNumber: controlNumber.trim(),
      documentType,
      affectedInvoiceNumber: affectedInvoiceNumber.trim() || undefined,
      totalAmountBs,
      paymentMethod,
      igtfApplicable,
      igtfRate: igtfApplicable ? 3 : 0,
      igtfAmountBs,
      igtfAmountUsd: bcvRate > 0 ? igtfAmountBs / bcvRate : 0,
      exemptAmountBs,
      taxableBaseBs: effectiveTaxableBaseBs,
      taxRate,
      vatCreditTreatment,
      vatAmountBs,
      additionalLuxuryTaxBs,
      additionalLuxuryTaxUsd: bcvRate > 0 ? additionalLuxuryTaxBs / bcvRate : 0,
      retentionRate,
      vatWithheldBs,
      supplierTaxStatus: resolvedSupplierTaxStatus,
      ivaRetentionDecision: { buyerAgentStatus, supplierTaxStatus: resolvedSupplierTaxStatus, article2Transaction, article3Exclusions: article3Exclusion ? [article3Exclusion] : [], portalArticle3ExclusionConfirmed, supplierImportPerceptionConfirmed, operationAmountBs, unitTaxValueBs: islrUnitTaxValueBs ?? undefined, vatNotDiscriminated, taxableAmountIncludingVatBs: vatNotDiscriminated ? taxableGrossBs : undefined, invoiceFormalDefect, ...(portalRetentionRate !== '' ? { portalRetentionRate: Number(portalRetentionRate) as 75 | 100 } : {}), decisionStatus: ivaEligibility.status, decisionReason: ivaEligibility.reason, legalBasis: ivaEligibility.legalBasis, evaluatedAt: new Date().toISOString() },
      islrConceptCode: applyIslr ? selectedConcept?.code : undefined,
      islrConceptName: applyIslr ? selectedConcept?.description : undefined,
      islrRate: applyIslr ? islrRate : 0,
      islrSubtrahendBs: applyIslr ? islrSubtrahendBs : 0,
      islrWithheldBs: applyIslr ? islrWithheldBs : 0,
      islrBeneficiaryType: applyIslr ? selectedConcept?.category : undefined,
      islrResidency: applyIslr && selectedConcept
        ? (selectedConcept.category === 'PN'
          ? (selectedConcept.isResident ? 'RESIDENT' : 'NON_RESIDENT')
          : (selectedConcept.isResident ? 'DOMICILED' : 'NON_DOMICILED'))
        : undefined,
      islrBasePercentage: applyIslr ? selectedConcept?.basePercentage : undefined,
      islrUnitTaxValueBs: applyIslr ? islrUnitTaxValueBs ?? undefined : undefined,
      islrFormulaFactor: applyIslr ? ISLR_FORMULA_FACTOR : undefined,
      bcvRate,
      totalAmountUsd,
      taxableBaseUsd,
      vatAmountUsd,
      vatWithheldUsd,
      islrWithheldUsd,
      notes: notes.trim() || undefined,
      paymentTerm,
      paymentAccountCode: paymentTerm === 'CONTADO' ? paymentAccountCode : undefined,
      paymentReference: paymentTerm === 'CONTADO' ? paymentReference.trim() : undefined,
      creditDays: paymentTerm === 'CREDITO' ? creditDays : 0,
      dueDate: paymentTerm === 'CREDITO' ? dueDate : invoiceDate,
      currencyPricingMode,
      fiscalAdjustmentMode,
      purchaseDebitAccountCode: linkInventory ? undefined : purchaseDebitAccountCode,
      inventoryLines: linkInventory ? inventoryLines.map(line => ({productId:line.productId,quantity:parseDecimalInput(line.quantity),unitCostBs:parseDecimalInput(line.unitCostBs)})) : undefined
      });
      if (linkInventory) {
        for (const line of inventoryLines) {
          const product = products.find(p => p.id === line.productId && p.companyId === currentCompany.id)!;
          const quantity = parseDecimalInput(line.quantity);
          const unitCostBs = parseDecimalInput(line.unitCostBs);
          addMovement({
            productId: product.id, productName: product.name, productCode: product.code,
            date: invoiceDate, type: 'ENTRADA', concept: 'COMPRA',
            documentRef: 'FAC-' + invoiceNumber.trim(), documentType: 'Factura de compra',
            counterpartyRif: formatRif(supplierRif), counterpartyName: supplierName.trim().toUpperCase(),
            bcvRate, quantity, unitCostBs, unitCostUsd: unitCostBs / bcvRate,
            totalCostBs: quantity * unitCostBs, totalCostUsd: quantity * unitCostBs / bcvRate,
            balanceQty: product.currentStock + quantity,
            balanceTotalBs: (product.currentStock + quantity) * product.avgCostBs,
            balanceTotalUsd: (product.currentStock + quantity) * product.avgCostUsd
          });
        }
      }
      });
      await waitForPersistence();
      onClose();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo registrar la compra. Verifica los datos e inténtalo nuevamente.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {hasTaxStatusHistory && !effectiveCompanyTaxStatus && <div role="alert" className="fixed left-4 right-4 top-4 z-[1200] rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-lg">No hay un período de condición tributaria registrado para la fecha de abono en cuenta {accountCreditDate || invoiceDate}. La condición del agente queda pendiente y la retención de IVA se enviará a revisión.</div>}
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Registrar Factura de Compra (SENIAT)</h3>
              <p className="text-xs text-slate-400">
                Alimentará el Libro de Compras, generará el Asiento Contable y Comprobantes de Retención
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {/* Supplier Info */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <span className="font-bold text-slate-800 uppercase tracking-wider block">
              1. Datos del Proveedor y Factura
            </span>
            <label className="flex items-center gap-2 text-slate-700 font-medium"><input type="checkbox" checked={vatNotDiscriminated} disabled={taxRate <= 0} onChange={e => { const checked = e.target.checked; setVatNotDiscriminated(checked); if (checked) setTaxableGrossInput(String(Math.round((taxableBaseBs + vatAmountBs) * 100) / 100)); }} /> La factura no discrimina el IVA (art. 5.1)</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">RIF Proveedor *</label>
                <input
                  type="text"
                  required
                  placeholder="J-12345678-9"
                  value={supplierRif}
                  onChange={e => { setSupplierRif(e.target.value); setSupplierTaxStatus("AUTO"); setArticle3Exclusion(""); setPortalArticle3ExclusionConfirmed(false); setSupplierImportPerceptionConfirmed(false); setArticle2Transaction(false); setInvoiceFormalDefect(false); setPortalRetentionRate(""); }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg uppercase font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Nombre / Razón Social *</label>
                <input
                  type="text"
                  required
                  placeholder="PROVEEDOR NACIONAL, C.A."
                  value={supplierName}
                  onChange={e => setSupplierName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg uppercase focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block font-semibold text-slate-700 mb-1">Domicilio fiscal del proveedor</label><input type="text" value={supplierAddress} onChange={e => setSupplierAddress(e.target.value)} maxLength={300} placeholder="Dirección fiscal declarada" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Correo electrónico del proveedor</label><input type="email" value={supplierEmail} onChange={e => setSupplierEmail(e.target.value)} maxLength={254} placeholder="proveedor@dominio.com" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /><p className="text-[10px] text-slate-500 mt-1">Dato opcional para comprobantes emitidos bajo el régimen vigente; se conservará como instantánea para futuras reimpresiones.</p></div>
            </div>

            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block font-semibold text-slate-700 mb-1">Condición fiscal del proveedor</label>
                  <select value={supplierTaxStatus} onChange={e => setSupplierTaxStatus(e.target.value as "AUTO" | IvaSupplierTaxStatus)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="AUTO">Reutilizar última clasificación / revisar si no existe</option><option value="ORDINARY">Contribuyente ordinario</option><option value="FORMAL">Contribuyente formal</option><option value="SPECIAL">Contribuyente especial</option><option value="NON_REGISTERED">No inscrito en el RIF</option><option value="UNKNOWN">No conozco la condición</option>
                  </select>
                  {supplierTaxStatus === "AUTO" && supplierProfilePurchase && <p className="text-[10px] text-slate-600 mt-1">Se reutiliza la clasificación de la compra #{supplierProfilePurchase.opNumber} de este proveedor.</p>}
                </div>
                <div><label className="block font-semibold text-slate-700 mb-1">Excepción del artículo 3 (si aplica)</label>
                  <select value={article3Exclusion} onChange={e => { setArticle3Exclusion(e.target.value as IvaArticle3Exclusion | ""); setPortalArticle3ExclusionConfirmed(false); setSupplierImportPerceptionConfirmed(false); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="">Ninguna identificada</option><option value="NOT_SUBJECT_EXEMPT_EXONERATED">Operación no sujeta, exenta o exonerada</option><option value="FORMAL_SUPPLIER">Proveedor contribuyente formal</option><option value="PERCEPTION_AGENT_SPECIFIC_GOODS">Proveedor agente de percepción (bienes específicos)</option><option value="IMPORT_PERCEPTION_CREDIT">IVA percibido anticipadamente en importación</option><option value="EMPLOYEE_TRAVEL_EXPENSE">Pago por empleado con viáticos</option><option value="REIMBURSABLE_UP_TO_20_UT">Gasto reembolsable hasta 20 UT</option><option value="PETTY_CASH_UP_TO_20_UT">Caja chica hasta 20 UT</option><option value="DOMICILIARY_UTILITIES">Servicios domiciliados de electricidad/agua/aseo/telefonía</option><option value="EXPORTER_RECOVERY_REGISTER">Exportador incluido en registro de recuperación de créditos fiscales</option><option value="SUPPLIER_EXEMPT_SALES_OVER_50">Proveedor con ventas exentas/exoneradas superiores al 50%</option><option value="SPECIAL_PUBLIC_PURCHASER">Compra por órgano público especial</option><option value="SPECIAL_NONBUSINESS_PUBLIC_ENTITY">Compra por ente público no empresarial especial</option><option value="COT_ARTICLE_146">Operación pagada según artículo 146 COT</option>
                  </select>
                </div>
              </div>
              {['PERCEPTION_AGENT_SPECIFIC_GOODS', 'EXPORTER_RECOVERY_REGISTER', 'SUPPLIER_EXEMPT_SALES_OVER_50'].includes(article3Exclusion) && <label className="flex items-start gap-2 text-amber-800"><input type="checkbox" checked={portalArticle3ExclusionConfirmed} onChange={e => setPortalArticle3ExclusionConfirmed(e.target.checked)} /> Confirmé esta exclusión en el Portal Fiscal</label>}
              {article3Exclusion === 'IMPORT_PERCEPTION_CREDIT' && <label className="flex items-start gap-2 text-amber-800"><input type="checkbox" checked={supplierImportPerceptionConfirmed} onChange={e => setSupplierImportPerceptionConfirmed(e.target.checked)} /> El proveedor acreditó que soportó la percepción anticipada de IVA en la importación</label>}
              {['REIMBURSABLE_UP_TO_20_UT', 'PETTY_CASH_UP_TO_20_UT'].includes(article3Exclusion) && <p className="text-[10px] text-slate-600">Límite legal: 20 UT. Importe de la operación: {formatBs(operationAmountBs)}. {islrUnitTaxValueBs ? ('Límite calculado con UT vigente (' + formatBs(islrUnitTaxValueBs) + '): ' + formatBs(islrUnitTaxValueBs * 20) + '.') : 'No existe UT verificada para este período; SICOVEN dejará la operación en revisión.'}</p>}
              {["ARTICLE_2_METALS", "ARTICLE_1_AND_2"].includes(currentCompany.ivaRetentionAgentBasis || "") && <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={article2Transaction} onChange={e => setArticle2Transaction(e.target.checked)} /> Esta compra corresponde a metales o piedras preciosas de la actividad del artículo 2</label>}
              <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={invoiceFormalDefect} onChange={e => setInvoiceFormalDefect(e.target.checked)} /> La factura incumple requisitos o formalidades fiscales (artículo 5.2)</label>
              <div><label className="block font-semibold text-slate-700 mb-1">Resultado de consulta Portal Fiscal (cuando corresponda)</label><select value={portalRetentionRate} onChange={e => setPortalRetentionRate(e.target.value as "" | "75" | "100")} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"><option value="">Sin consulta confirmada</option><option value="75">Portal confirma retención general del 75%</option><option value="100">Portal confirma retención del 100% / proveedor no inscrito</option></select></div>
              <div className="rounded-lg border p-3"><div className="flex justify-between gap-2 items-center"><strong className="text-slate-800">Evaluación automática de retención IVA</strong><strong>{ivaEligibility.status === "WITHHOLD" ? retentionRate + "%" : ivaEligibility.status === "REVIEW" ? "Revisión" : "Sin retención"}</strong></div>
                <p className="mt-1 text-slate-700">{ivaEligibility.reason}</p>{ivaEligibility.legalBasis && <p className="text-[10px] text-slate-500 mt-1">{ivaEligibility.legalBasis}</p>}<p className="font-semibold mt-1">IVA retenido estimado: {formatBs(vatWithheldBs)}</p></div>
              <p className="text-[10px] text-slate-600">La clasificación se reutiliza por RIF en compras posteriores. Las consultas del Portal Fiscal no se simulan: si faltan, la operación queda en revisión.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tipo de Documento</label>
                <select
                  value={documentType}
                  onChange={e => setDocumentType(e.target.value as any)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="01">01 - Factura</option>
                  <option value="02" disabled>02 - Nota de Débito (flujo contable pendiente)</option>
                  <option value="03" disabled>03 - Nota de Crédito (usar Devolver en factura original)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fecha Emisión *</label>
                <input
                  type="date"
                  required
                  value={invoiceDate}
                  onChange={e => setInvoiceDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fecha Abono en Cuenta *</label>
                <input
                  type="date"
                  required
                  value={accountCreditDate}
                  onChange={e => setAccountCreditDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-500 mt-1">{paymentTerm === 'CONTADO' ? 'Para contado, registra aquí la fecha efectiva del pago y su reconocimiento contable.' : 'Fecha de reconocimiento del pasivo; puede diferir de la emisión.'}</p>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">N° de Factura *</label>
                <input
                  type="text"
                  required
                  placeholder="00012345"
                  value={invoiceNumber}
                  onChange={e => setInvoiceNumber(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">N° de Control *</label>
                <input
                  type="text"
                  required
                  placeholder="00-001234"
                  value={controlNumber}
                  onChange={e => setControlNumber(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Tax Base & VAT */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 uppercase tracking-wider block">
                2. Montos e Impuesto al Valor Agregado (IVA)
              </span>
              <div className="text-slate-500 font-mono-nums">
                Tasa BCV aplicable a la factura
                <input required type="text" inputMode="decimal" value={bcvRateInput} onChange={e => setBcvRateInput(e.target.value)} placeholder="Ej.: 889,67" className="ml-2 w-36 rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{vatNotDiscriminated ? 'Precio gravado con IVA incluido (Bs. — {getVenezuelanMonetaryEra(invoiceDate).label}) *' : 'Base Imponible (Bs. — {getVenezuelanMonetaryEra(invoiceDate).label}) *'}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                  value={vatNotDiscriminated ? taxableGrossInput : taxableBaseInput}
                  onChange={e => { const value = e.target.value; if (vatNotDiscriminated) { setTaxableGrossInput(value); setTaxableBaseInput(String(taxRate > 0 ? Math.round((parseDecimalInput(value) / (1 + taxRate / 100) + Number.EPSILON) * 100) / 100 : 0)); } else setTaxableBaseInput(value); }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
                <span className="text-[11px] text-slate-500 font-mono">
                  {formatUsd(taxableBaseUsd)}
                </span>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Monto Exento / Exonerado (Bs. — {getVenezuelanMonetaryEra(invoiceDate).label})</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={exemptAmountInput}
                  onChange={e => setExemptAmountInput(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Alícuota IVA</label>
                <select
                  value={taxRate}
                  onChange={e => { const rate = Number(e.target.value); setTaxRate(rate); if (rate === 0 && vatNotDiscriminated) { setTaxableBaseInput(String(taxableGrossBs)); setTaxableGrossInput(''); setVatNotDiscriminated(false); } }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-semibold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value={16}>16% (Alícuota General SENIAT)</option>
                  <option value={8}>8% (Alícuota Reducida)</option>
                  <option value={31}>31% (Alícuota General + Adicional Lujo)</option>
                  <option value={0}>0% (Exento)</option>
                </select>
              <div className="mt-3">
                <label className="block font-semibold text-slate-700 mb-1">Destino del crédito fiscal IVA</label>
                <select value={vatCreditTreatment} onChange={event=>setVatCreditTreatment(event.target.value as 'TAXABLE'|'EXEMPT'|'COMMON')} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm">
                  <option value="COMMON">Común: aplicar prorrata automáticamente</option>
                  <option value="TAXABLE">Exclusivo de operaciones gravadas: 100% acreditable</option>
                  <option value="EXEMPT">Exclusivo de operaciones exentas: no acreditable</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">Se conserva en la factura y en sus notas para determinar correctamente el crédito fiscal del período.</p>
              </div>
              </div>
            </div>

            {/* Resultado calculado; la tasa no se selecciona manualmente */}
            <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <span className="block font-semibold text-slate-700 mb-1">Retención IVA determinada por Providencia 000054</span>
                <span className="font-bold text-purple-800">{ivaEligibility.status === 'WITHHOLD' ? retentionRate + '% del IVA causado' : ivaEligibility.status === 'REVIEW' ? 'Pendiente de revisión' : 'No aplica'}</span>
                <p className="text-[10px] text-slate-500 mt-1">{ivaEligibility.reason}</p>
              </div>
              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-200 flex items-center justify-between">
                <div><span className="text-[11px] text-emerald-800 block font-medium">IVA Retenido (Bs.):</span><span className="font-mono font-bold text-emerald-700 text-sm">{formatBs(vatWithheldBs)}</span></div>
                <div className="text-right text-[11px] text-emerald-800 font-mono">{formatUsd(vatWithheldUsd)}</div>
              </div>
            </div>
          </div>
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
            <span className="font-bold text-slate-800 uppercase tracking-wider block">3. Método de pago e IGTF</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block font-semibold text-slate-700 mb-1">Método de pago previsto</label>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as typeof paymentMethod)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="BS">Bolívares / medios nacionales</option><option value="FOREIGN_CASH">Divisas en efectivo</option><option value="ZELLE">Zelle</option><option value="INTERNATIONAL_TRANSFER">Transferencia internacional</option><option value="CRYPTO">Criptoactivos</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-slate-700 font-semibold"><input type="checkbox" checked={applyIgtf} onChange={e => setApplyIgtf(e.target.checked)} disabled={paymentMethod === 'BS' || paymentTerm === 'CREDITO'} className="rounded text-amber-600"/> Aplicar IGTF 3% (confirmación fiscal)</label>
            </div>
            <div className="flex justify-between items-center text-sm"><span>IGTF calculado sobre subtotal</span><strong className="font-mono">{formatBs(igtfAmountBs)}</strong></div>
            {paymentTerm === 'CREDITO' && <p className="text-xs text-amber-900 bg-amber-100 border border-amber-300 rounded-lg p-3">El IGTF no se anticipa en una factura a crédito. La obligación se evalúa cuando se realice el débito o se cancele la deuda; registre el impuesto en el flujo de pago cuando esté habilitado y conciliado.</p>}
            <p className="text-[11px] text-amber-900">Antes de activar el cálculo del IGTF, el contador debe validar que la operación esté sujeta al impuesto, la base imponible aplicable y el tratamiento contable y tributario vigente. El método de pago por sí solo no determina la obligación fiscal; active esta opción únicamente después de esa revisión.</p>
          </div>

          {/* ISLR Withholding Option */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 font-bold text-slate-800 uppercase tracking-wider cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyIslr}
                  onChange={e => setApplyIslr(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                3. Aplicar Retención de ISLR (Decreto 1808)
              </label>
              {applyIslr && (
                <span className="text-xs text-slate-500 font-mono">
                  Tarifa: <strong>{selectedConcept?.rate}%</strong>
                </span>
              )}
            </div>

            {applyIslr && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Concepto de Retención Oficial:
                  </label>
                  <select
                    required
                    value={islrConceptCode}
                    onChange={e => setIslrConceptCode(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="">Seleccione el concepto que corresponde a la operación…</option>
                    {ISLR_CONCEPTS.map(c => (
                      <option key={c.code} value={c.code}>
                        Cod. {c.code} ({c.rate}%) - {c.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3 bg-purple-50 p-2.5 rounded-lg border border-purple-200 text-xs">
                  <div>
                    <span className="text-[11px] text-purple-800 block">U.T. aplicada / factor:</span>
                    <span className="font-mono font-bold text-purple-900">Bs. {islrUnitTaxValueBs == null ? 'No disponible' : islrUnitTaxValueBs.toFixed(2)} / {ISLR_FORMULA_FACTOR}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-purple-800 block">Sustraendo Legal (Bs.):</span>
                    <span className="font-mono font-bold text-purple-900">{formatBs(islrSubtrahendBs)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-purple-800 block">Monto ISLR a Retener:</span>
                    <span className="font-mono font-bold text-purple-900">{formatBs(islrWithheldBs)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-purple-900">Catálogo parcial verificado. Los conceptos con tarifa acumulativa/progresiva y otros códigos aún no implementados no se ofrecen. La base utilizada es la base imponible de esta factura; confirma que corresponda al concepto fiscal.</p>
              </div>
            )}
          </div>

          <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-xl space-y-2">
            <span className="font-bold text-slate-800 uppercase tracking-wider block">Vista previa del asiento contable</span>
            <div className="grid grid-cols-3 gap-2 font-semibold text-slate-600 border-b border-sky-200 pb-1"><span>Cuenta / concepto</span><span className="text-right">Debe (Bs.)</span><span className="text-right">Haber (Bs.)</span></div>
            {[
              {name: linkInventory ? 'Inventario / mercancía' : (nonInventoryDebitAccounts.find(account=>account.code===purchaseDebitAccountCode)?.name || 'Cuenta de gasto/activo por seleccionar'), debit: effectiveTaxableBaseBs, credit: 0},
              ...(exemptAmountBs > 0 ? [{name:'Monto exento', debit:exemptAmountBs, credit:0}] : []),
              ...(vatAmountBs > 0 ? [{name:'Crédito fiscal IVA', debit:vatAmountBs, credit:0}] : []),
              ...(igtfAmountBs > 0 ? [{name:'Gasto por IGTF', debit:igtfAmountBs, credit:0}] : []),
              ...(vatWithheldBs > 0 ? [{name:'Retención IVA por enterar', debit:0, credit:vatWithheldBs}] : []),
              ...(islrWithheldBs > 0 ? [{name:'Retención ISLR por enterar', debit:0, credit:islrWithheldBs}] : []),
              {name: paymentTerm === 'CONTADO' ? (paymentAccounts.find(account => account.code === paymentAccountCode)?.name || 'Cuenta de Caja/Banco') : 'Cuenta por pagar proveedor', debit:0, credit:Math.max(0,totalAmountBs-vatWithheldBs-islrWithheldBs)}
            ].map((line, index) => <div key={index} className="grid grid-cols-3 gap-2 text-slate-700"><span>{line.name}</span><span className="text-right font-mono">{formatBs(line.debit)}</span><span className="text-right font-mono">{formatBs(line.credit)}</span></div>)}
            <div className="grid grid-cols-3 gap-2 border-t border-sky-200 pt-2 font-bold"><span>Totales</span><span className="text-right font-mono">{formatBs(effectiveTaxableBaseBs+exemptAmountBs+vatAmountBs+igtfAmountBs)}</span><span className="text-right font-mono">{formatBs(vatWithheldBs+islrWithheldBs+Math.max(0,totalAmountBs-vatWithheldBs-islrWithheldBs))}</span></div>
            <p className="text-[11px] text-slate-600">Vista previa estimada; la validación definitiva se ejecuta al guardar.</p>
          </div>

          {/* Condiciones de crédito y ajuste cambiario */}
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
            <span className="font-bold text-slate-800 uppercase tracking-wider block">4. Condiciones de pago/cobro y ajuste cambiario</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block font-semibold text-slate-700 mb-1">Forma de pago</label><select value={paymentTerm} onChange={e => setPaymentTerm(e.target.value as 'CONTADO' | 'CREDITO')} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></select></div>
              {paymentTerm === 'CREDITO' && <div><label className="block font-semibold text-slate-700 mb-1">Plazo del crédito (días)</label><input type="number" min="1" max="3650" value={creditDays} onChange={e => setCreditDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"/><span className="text-[11px] text-slate-600">Vencimiento calculado: {dueDate}</span></div>}
            </div>
            {paymentTerm === 'CONTADO' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div><label className="block font-semibold text-slate-700 mb-1">Cuenta contable de pago / origen del dinero *</label><select required value={paymentAccountCode} onChange={e => setPaymentAccountCode(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"><option value="">Selecciona Caja o Banco...</option>{paymentAccounts.map(account => <option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}</select>{paymentAccounts.length === 0 && <p className="text-xs text-red-700 mt-1">No hay cuentas de Caja/Banco de movimiento disponibles en el Plan de Cuentas.</p>}</div>
              <div><label className="block font-semibold text-slate-700 mb-1">Comprobante / referencia del pago *</label><input required value={paymentReference} onChange={e => setPaymentReference(e.target.value)} maxLength={200} placeholder="N.º de egreso, transferencia o soporte" className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"/><p className="text-[11px] text-slate-600 mt-1">Se conserva en la factura y en la descripción del asiento para auditoría.</p></div>
              <p className="sm:col-span-2 text-xs text-emerald-900">El asiento acreditará esta cuenta por el neto pagado, después de las retenciones aplicables. No se crea una CxP ni se requiere una caja registradora.</p>
            </div>}
            {paymentTerm === 'CREDITO' && <>
              <div><label className="block font-semibold text-slate-700 mb-1">Condición contractual del precio</label><select value={currencyPricingMode} onChange={e => setCurrencyPricingMode(e.target.value as typeof currencyPricingMode)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"><option value="USD_FIJO">Precio fijo en USD; liquidación según contrato</option><option value="BS_AJUSTABLE">Precio en Bs. ajustable por tasa BCV al liquidar</option><option value="REVISION_MANUAL">Otra condición; requiere revisión manual</option></select></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Tratamiento del ajuste fiscal</label><select value={fiscalAdjustmentMode} onChange={e => setFiscalAdjustmentMode(e.target.value as typeof fiscalAdjustmentMode)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"><option value="IVA_ORIGINAL_DIF_CAMBIARIA">Conservar IVA original y evaluar diferencia cambiaria</option><option value="AJUSTE_BASE_IVA">Evaluar ajuste de base e IVA mediante documento aplicable</option><option value="REVISION_CONTADOR">Revisión del contador antes de registrar ajuste fiscal</option></select></div>
              <div className="rounded-lg bg-white border border-amber-200 p-3 text-[11px] text-slate-700">{currencyPricingMode === 'USD_FIJO' ? 'Se conserva el importe contractual en USD; se evaluará la diferencia cambiaria al liquidar.' : currencyPricingMode === 'BS_AJUSTABLE' ? 'Se calculará una variación preliminar del precio en Bs.; el efecto fiscal debe validarse antes de emitir documentos.' : 'La liquidación y el ajuste quedarán sujetos a revisión manual.'} La selección no modifica la factura original ni autoriza por sí sola emitir notas fiscales.</div>
            </>}
          </div>
          <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl space-y-3">
            <div className="flex items-start gap-2">
              <input id="linkInventory" type="checkbox" checked={linkInventory} onChange={e=>setLinkInventory(e.target.checked)} className="mt-1" />
              <label htmlFor="linkInventory" className="font-bold text-slate-800">Vincular mercancía de esta factura con artículos existentes del Kardex</label>
            </div>
            <p className="text-[11px] text-slate-600">Si la factura corresponde a mercancía para la venta, registra sus artículos y cantidades: el sistema debitará Inventario y actualizará el Kardex. Si corresponde a servicios, honorarios, gastos o activos, desmarca esta opción y selecciona la cuenta contable específica de gasto, costo o activo. No se asignará ninguna cuenta automáticamente.</p>
            {!linkInventory && <div className="rounded-lg border border-amber-200 bg-white p-3"><label className="mb-1 block font-semibold text-slate-800">Cuenta de débito para servicio, gasto o activo *</label><select required value={purchaseDebitAccountCode} onChange={e=>setPurchaseDebitAccountCode(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Selecciona la cuenta contable correspondiente…</option>{nonInventoryDebitAccounts.map(account=><option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}</select><p className="mt-1 text-[10px] text-slate-500">Honorarios Profesionales solo se usará si lo seleccionas expresamente y corresponde a la naturaleza de la compra.</p></div>}
            {linkInventory && <>
              {inventoryLines.map((line,index)=><div key={index} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end rounded-lg bg-white border border-indigo-100 p-2">
                <div className="sm:col-span-6"><label className="block font-semibold mb-1">Artículo existente</label><select required value={line.productId} onChange={e=>setInventoryLines(prev=>prev.map((item,i)=>i===index?{...item,productId:e.target.value,unitCostBs:item.unitCostBs || String(products.find(p=>p.id===e.target.value)?.avgCostBs || 0)}:item))} className="w-full rounded border border-slate-300 p-2"><option value="">Seleccionar artículo…</option>{products.filter(p=>p.companyId===currentCompany.id).map(p=><option key={p.id} value={p.id}>{p.code} · {p.name} · Existencia {p.currentStock}</option>)}</select></div>
                <div className="sm:col-span-2"><label className="block font-semibold mb-1">Cantidad</label><input required type="text" inputMode="decimal" value={line.quantity} onChange={e=>setInventoryLines(prev=>prev.map((item,i)=>i===index?{...item,quantity:e.target.value}:item))} className="w-full rounded border border-slate-300 p-2"/></div>
                <div className="sm:col-span-3"><label className="block font-semibold mb-1">Costo unitario Bs.</label><input required type="text" inputMode="decimal" value={line.unitCostBs} onChange={e=>setInventoryLines(prev=>prev.map((item,i)=>i===index?{...item,unitCostBs:e.target.value}:item))} className="w-full rounded border border-slate-300 p-2"/></div>
                <div className="sm:col-span-1"><button type="button" disabled={inventoryLines.length===1} onClick={()=>setInventoryLines(prev=>prev.filter((_,i)=>i!==index))} className="w-full rounded border border-red-200 px-2 py-2 text-red-700 disabled:opacity-30" aria-label="Eliminar línea">×</button></div>
              </div>)}
              <button type="button" onClick={()=>setInventoryLines(prev=>[...prev,{productId:'',quantity:'1',unitCostBs:''}])} className="rounded-lg border border-indigo-300 bg-white px-3 py-2 font-semibold text-indigo-800">+ Añadir artículo</button>
              <div className={Math.abs(inventoryLineTotal-(effectiveTaxableBaseBs+exemptAmountBs))<=0.02 && inventoryLinesValid?'text-emerald-700':'text-rose-700'}>
                <strong>Total líneas:</strong> {formatBs(inventoryLineTotal)} · <strong>Base + exento:</strong> {formatBs(effectiveTaxableBaseBs+exemptAmountBs)}
              </div>
              {!inventoryLinesValid && <p className="text-rose-700 font-semibold">Las líneas no concilian; no se permitirá guardar.</p>}
            </>}
          </div>

          {/* Summary Box */}
          <div className="bg-slate-900 text-white p-4 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Total de compra:</span>
              <span className="font-mono font-bold">{formatBs(totalAmountBs)} ({formatUsd(totalAmountUsd)})</span>
            </div>
            <div className="flex justify-between items-center text-xs text-slate-300"><span>IVA acreditable ({effectiveVatRate}%):</span><span className="font-mono">{formatBs(vatAmountBs)}</span></div>
            {additionalLuxuryTaxBs > 0 && <div className="flex justify-between items-center text-xs text-amber-200"><span>Impuesto adicional no acreditable (15%):</span><span className="font-mono">{formatBs(additionalLuxuryTaxBs)}</span></div>}
            <div className="flex justify-between items-center text-xs text-slate-300"><span>IGTF:</span><span className="font-mono">{formatBs(igtfAmountBs)}</span></div>
            <div className="flex justify-between items-center text-xs text-rose-300">
              <span>(-) Retención IVA ({retentionRate}%):</span>
              <span className="font-mono">-{formatBs(vatWithheldBs)}</span>
            </div>
            {applyIslr && (
              <div className="flex justify-between items-center text-xs text-purple-300">
                <span>(-) Retención ISLR:</span>
                <span className="font-mono">-{formatBs(islrWithheldBs)}</span>
              </div>
            )}
            <div className="border-t border-slate-800 pt-2 flex justify-between items-center text-sm font-bold text-emerald-400">
              <span>(=) Neto a Cancelar al Proveedor:</span>
              <span className="font-mono">{formatBs(netPayableBs)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition cursor-pointer disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || totalAmountBs <= 0}
              className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer disabled:opacity-40"
            >
              <Check className="w-4 h-4" />
              {saving ? "Confirmando SQLite..." : "Guardar Compra y Generar Asientos"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
