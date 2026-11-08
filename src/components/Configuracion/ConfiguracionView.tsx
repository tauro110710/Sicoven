import React, { useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import {
  Settings,
  Building2,
  Save,
  Download,
  Upload,
  RotateCcw,
  Plus,
  CheckCircle2,
  ShieldCheck,
  Scale,
  RefreshCw,
  Info,
  AlertCircle,
  CalendarCheck,
  LockKeyhole
} from 'lucide-react';
import { AccountingFramework, TaxpayerType, IvaRetentionAgentBasis, JournalEntryItem, AccountingCurrencyCode, FunctionalCurrencyAssessment, ExchangeabilityAssessment } from '../../types/accounting';
import { validateFunctionalCurrencyAssessment, validateExchangeabilityAssessment } from '../../types/functionalCurrency';
import { buildOpeningEntryItems } from '../../types/accountingYearOpening';
import { CompanyModal } from '../CompanyModal';
import { formatBs, validateVenezuelanRif } from '../../utils/formatters';
import { IntelligentMigrationWizard } from '../Migracion/IntelligentMigrationWizard';

export const ConfiguracionView: React.FC = () => {
  const {
    companies,
    currentCompany,
    setCurrentCompanyId,
    updateCompany,
    waitForPersistence,
    resetToSampleData,
    resetFactoryData,
    exportBackupJson,
    restoreBackupJson,
    closeAccountingPeriod,
    reopenAccountingPeriod,
    createAccountingYearOpening,
    accounts,
    journalEntries,
    isStorageReady
  } = useAccounting();

  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [showUniversalMigrationWizard, setShowUniversalMigrationWizard] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [companySaveBusy, setCompanySaveBusy] = useState(false);
  const companySaveInFlightRef = React.useRef(false);
  const [factoryResetBusy, setFactoryResetBusy] = useState(false);
  const [factoryResetStage, setFactoryResetStage] = useState('');
  const [backupRestoreBusy, setBackupRestoreBusy] = useState(false);
  const [periodCloseDate, setPeriodCloseDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  });
  const [periodCloseBusy, setPeriodCloseBusy] = useState(false);
  const [reopenThroughDate, setReopenThroughDate] = useState(() => {
    if (!currentCompany.closedThroughDate) return '';
    const date = new Date(currentCompany.closedThroughDate + 'T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  });
  const [reopenReason, setReopenReason] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [openingPeriodStart, setOpeningPeriodStart] = useState(() => String(currentCompany.fiscalYear) + '-01-01');
  const [openingPeriodEnd, setOpeningPeriodEnd] = useState(currentCompany.closedThroughDate || (String(currentCompany.fiscalYear) + '-12-31'));
  const [openingDate, setOpeningDate] = useState(() => {
    const end = currentCompany.closedThroughDate || (String(currentCompany.fiscalYear) + '-12-31');
    const date = new Date(end + 'T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  });
  const [openingBcvRateInput, setOpeningBcvRateInput] = useState('');
  const [retainedEarningsAccountCode, setRetainedEarningsAccountCode] = useState('');
  const [openingPreview, setOpeningPreview] = useState<JournalEntryItem[] | null>(null);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [openingBusy, setOpeningBusy] = useState(false);

  // Form state for current company editing
  const [name, setName] = useState(currentCompany.name);
  const [tradeName, setTradeName] = useState(currentCompany.tradeName || '');
  const [rif, setRif] = useState(currentCompany.rif);
  const [rifError, setRifError] = useState<string | null>(null);
  const [taxpayerType, setTaxpayerType] = useState<TaxpayerType>(currentCompany.taxpayerType);
  const [defaultIvaRetentionRate, setDefaultIvaRetentionRate] = useState<number>(
    currentCompany.defaultIvaRetentionRate
  );
  const [ivaRetentionAgentBasis, setIvaRetentionAgentBasis] = useState<IvaRetentionAgentBasis>(currentCompany.ivaRetentionAgentBasis || 'UNCONFIRMED');
  const [isPersonalFirm, setIsPersonalFirm] = useState<boolean>(currentCompany.isPersonalFirm === true);
  const [isIgtfPerceptionAgent, setIsIgtfPerceptionAgent] = useState<boolean>(currentCompany.isIgtfPerceptionAgent === true);
  const [address, setAddress] = useState(currentCompany.address);
  const [phone, setPhone] = useState(currentCompany.phone);
  const [email, setEmail] = useState(currentCompany.email);
  const [fiscalYear, setFiscalYear] = useState(currentCompany.fiscalYear);
  const [accountingFramework, setAccountingFramework] = useState<AccountingFramework | ''>(currentCompany.accountingFramework || '');
  const [accountingFrameworkVersion, setAccountingFrameworkVersion] = useState(currentCompany.accountingFrameworkVersion || '');
  const [accountingFrameworkAdoptionDate, setAccountingFrameworkAdoptionDate] = useState(currentCompany.accountingFrameworkAdoptionDate || '');
  const [specialTaxpayerNotificationReference, setSpecialTaxpayerNotificationReference] = useState(currentCompany.specialTaxpayerNotificationReference || '');
  const [specialTaxpayerNotificationDate, setSpecialTaxpayerNotificationDate] = useState(currentCompany.specialTaxpayerNotificationDate || '');
  const [functionalCurrency, setFunctionalCurrency] = useState<AccountingCurrencyCode | ''>('');
  const [functionalCurrencyOther, setFunctionalCurrencyOther] = useState('');
  const [presentationCurrency, setPresentationCurrency] = useState<AccountingCurrencyCode | ''>('');
  const [presentationCurrencyOther, setPresentationCurrencyOther] = useState('');
  const [currencyAssessmentStatus, setCurrencyAssessmentStatus] = useState<'DRAFT' | 'APPROVED'>('DRAFT');
  const [currencyAssessmentDate, setCurrencyAssessmentDate] = useState('');
  const [currencyEffectiveDate, setCurrencyEffectiveDate] = useState('');
  const [currencyPreparedBy, setCurrencyPreparedBy] = useState('');
  const [currencyApprovedBy, setCurrencyApprovedBy] = useState('');
  const [currencyApprovedAt, setCurrencyApprovedAt] = useState('');
  const [primaryEconomicEnvironment, setPrimaryEconomicEnvironment] = useState('');
  const [salesPriceFactors, setSalesPriceFactors] = useState('');
  const [costFactors, setCostFactors] = useState('');
  const [financingFactors, setFinancingFactors] = useState('');
  const [operatingReceiptsFactors, setOperatingReceiptsFactors] = useState('');
  const [currencyProfessionalConclusion, setCurrencyProfessionalConclusion] = useState('');
  const [currencyEvidenceReferences, setCurrencyEvidenceReferences] = useState('');
  const [exchangeabilityDraft, setExchangeabilityDraft] = useState<Partial<ExchangeabilityAssessment>>({
    legallyAccessible: false, actuallyAccessible: false, conclusion: 'NOT_CONVERTIBLE'
  });
  const [exchangeabilityEvidence, setExchangeabilityEvidence] = useState('');
  const [exchangeabilityInputs, setExchangeabilityInputs] = useState({ amountRequired: '', expectedDelayDays: '', amountAvailable: '', accessibleSpotRate: '', estimatedSpotRate: '' });
  const parseExchangeabilityNumber = (value: string) => { const raw = value.trim(); return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw); };

  // Sync state if currentCompany switches
  React.useEffect(() => {
    setName(currentCompany.name);
    setTradeName(currentCompany.tradeName || '');
    setRif(currentCompany.rif);
    setRifError(null);
    setTaxpayerType(currentCompany.taxpayerType);
    setDefaultIvaRetentionRate(currentCompany.defaultIvaRetentionRate);
    setIvaRetentionAgentBasis(currentCompany.ivaRetentionAgentBasis || 'UNCONFIRMED');
    setIsPersonalFirm(currentCompany.isPersonalFirm === true);
    setIsIgtfPerceptionAgent(currentCompany.isIgtfPerceptionAgent === true);
    setAddress(currentCompany.address);
    setPhone(currentCompany.phone);
    setEmail(currentCompany.email);
    setFiscalYear(currentCompany.fiscalYear);
    setAccountingFramework(currentCompany.accountingFramework || '');
    setAccountingFrameworkVersion(currentCompany.accountingFrameworkVersion || '');
    setAccountingFrameworkAdoptionDate(currentCompany.accountingFrameworkAdoptionDate || '');
    setSpecialTaxpayerNotificationReference(currentCompany.specialTaxpayerNotificationReference || '');
    setSpecialTaxpayerNotificationDate(currentCompany.specialTaxpayerNotificationDate || '');
    setFunctionalCurrency(''); setFunctionalCurrencyOther('');
    setPresentationCurrency(''); setPresentationCurrencyOther('');
    setCurrencyAssessmentStatus('DRAFT'); setCurrencyAssessmentDate(''); setCurrencyEffectiveDate('');
    setCurrencyPreparedBy(''); setCurrencyApprovedBy(''); setCurrencyApprovedAt('');
    setPrimaryEconomicEnvironment(''); setSalesPriceFactors(''); setCostFactors('');
    setFinancingFactors(''); setOperatingReceiptsFactors('');
    setCurrencyProfessionalConclusion(''); setCurrencyEvidenceReferences('');
    setExchangeabilityDraft({ legallyAccessible: false, actuallyAccessible: false, conclusion: 'NOT_CONVERTIBLE' });
    setExchangeabilityEvidence('');
    setPeriodCloseDate(currentCompany.closedThroughDate || (() => {
      const now = new Date();
      return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    })());
  }, [currentCompany]);

  React.useEffect(() => {
    if (!currentCompany.closedThroughDate) {
      setReopenThroughDate('');
    } else {
      const previous = new Date(currentCompany.closedThroughDate + 'T00:00:00.000Z');
      previous.setUTCDate(previous.getUTCDate() - 1);
      setReopenThroughDate(previous.toISOString().slice(0, 10));
    }
    setReopenReason('');
    setReopenError(null);
  }, [currentCompany.id, currentCompany.closedThroughDate]);

  React.useEffect(() => {
    const start = String(currentCompany.fiscalYear) + '-01-01';
    const end = currentCompany.closedThroughDate || (String(currentCompany.fiscalYear) + '-12-31');
    const next = new Date(end + 'T00:00:00.000Z');
    next.setUTCDate(next.getUTCDate() + 1);
    setOpeningPeriodStart(start);
    setOpeningPeriodEnd(end);
    setOpeningDate(next.toISOString().slice(0, 10));
    setRetainedEarningsAccountCode('');
    setOpeningPreview(null);
    setOpeningError(null);
  }, [currentCompany.id, currentCompany.fiscalYear, currentCompany.closedThroughDate]);

  React.useEffect(() => {
    setOpeningPreview(null);
    setOpeningError(null);
  }, [accounts, journalEntries]);

  const handlePreviewOpening = () => {
    setOpeningError(null);
    setOpeningPreview(null);
    try {
      if (!currentCompany.closedThroughDate || openingPeriodEnd !== currentCompany.closedThroughDate) {
        throw new Error('Cierre primero el ejercicio y use como fecha final el cierre confirmado de esta empresa.');
      }
      const preview = buildOpeningEntryItems({
        companyId: currentCompany.id,
        periodStartDate: openingPeriodStart,
        periodEndDate: openingPeriodEnd,
        openingDate,
        accounts,
        journalEntries,
        retainedEarningsAccountCode: retainedEarningsAccountCode || undefined
      });
      setOpeningPreview(preview);
    } catch (error) {
      setOpeningError(error instanceof Error ? error.message : 'No se pudo preparar la vista previa del asiento.');
    }
  };

  const handlePostOpening = async () => {
    const openingBcvRate = parseExchangeabilityNumber(openingBcvRateInput);
    if (!Number.isFinite(openingBcvRate) || openingBcvRate <= 0) {
      setOpeningError('Ingrese la tasa BCV histórica aplicable al asiento de apertura, por ejemplo 889,67.');
      return;
    }
    if (!openingPreview) {
      setOpeningError('Genere y revise la vista previa antes de registrar el asiento.');
      return;
    }
    const totals = openingPreview.reduce((sum, item) => ({
      debitBs: sum.debitBs + item.debitBs, creditBs: sum.creditBs + item.creditBs,
      debitUsd: sum.debitUsd + item.debitUsd, creditUsd: sum.creditUsd + item.creditUsd
    }), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
    const confirmed = window.confirm(
      'REGISTRAR ASIENTO DE APERTURA\\n\\nEmpresa: ' + currentCompany.name +
      '\\nFecha: ' + openingDate +
      '\\nTasa BCV: Bs. ' + openingBcvRateInput + ' por USD' +
      '\\nTotal debe: Bs. ' + totals.debitBs.toFixed(2) + ' / $ ' + totals.debitUsd.toFixed(6) +
      '\\nTotal haber: Bs. ' + totals.creditBs.toFixed(2) + ' / $ ' + totals.creditUsd.toFixed(6) +
      '\\n\\nEl asiento se guardará en SQLite y quedará registrado en la bitácora. Esta acción no se ejecuta automáticamente. ¿Confirma?'
    );
    if (!confirmed) return;
    setOpeningBusy(true);
    setOpeningError(null);
    try {
      const created = await createAccountingYearOpening({
        periodStartDate: openingPeriodStart,
        periodEndDate: openingPeriodEnd,
        openingDate,
        bcvRate: openingBcvRate,
        retainedEarningsAccountCode: retainedEarningsAccountCode || undefined
      });
      setOpeningPreview(null);
      alert('Asiento de apertura #' + created.entryNumber + ' registrado y confirmado por SQLite. La bitácora fue actualizada.');
    } catch (error) {
      setOpeningError(error instanceof Error ? error.message : 'SQLite no confirmó el asiento de apertura.');
    } finally {
      setOpeningBusy(false);
    }
  };

  const handleRifChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setRif(val);
    setIsPersonalFirm(false);
    if (rifError) {
      const res = validateVenezuelanRif(val);
      setRifError(res.error);
    }
  };

  const handleRifBlur = () => {
    const res = validateVenezuelanRif(rif);
    setRifError(res.error);
    if (res.isValid) {
      setRif(res.formattedRif);
    }
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    const rifValidation = validateVenezuelanRif(rif);
    if (!rifValidation.isValid) {
      setRifError(rifValidation.error);
      return;
    }
    setRifError(null);
    const hasSpecialNoticeMetadata = Boolean(specialTaxpayerNotificationReference.trim() || specialTaxpayerNotificationDate);
    if (taxpayerType === 'ESPECIAL' && currentCompany.taxpayerType !== 'ESPECIAL' && (!specialTaxpayerNotificationReference.trim() || !specialTaxpayerNotificationDate)) {
      window.alert('Para cambiar la empresa a Contribuyente Especial, indique la referencia y fecha de la notificación expresa del SENIAT.');
      return;
    }
    if (hasSpecialNoticeMetadata && (!specialTaxpayerNotificationReference.trim() || !specialTaxpayerNotificationDate)) {
      window.alert('Complete tanto la referencia como la fecha de la notificación SENIAT.');
      return;
    }
    if ((accountingFramework || accountingFrameworkVersion.trim() || accountingFrameworkAdoptionDate) && (!accountingFramework || !accountingFrameworkVersion.trim() || !accountingFrameworkAdoptionDate)) {
      window.alert('Para registrar la adopción VEN-NIF debe completar marco, versión normativa y fecha documentada.');
      return;
    }
    const hasCurrencyAssessmentInput = Boolean(
      functionalCurrency || functionalCurrencyOther.trim() || presentationCurrency ||
      presentationCurrencyOther.trim() || currencyAssessmentDate || currencyEffectiveDate ||
      currencyPreparedBy.trim() || currencyApprovedBy.trim() || currencyApprovedAt ||
      primaryEconomicEnvironment.trim() || salesPriceFactors.trim() || costFactors.trim() ||
      financingFactors.trim() || operatingReceiptsFactors.trim() ||
      currencyProfessionalConclusion.trim() || currencyEvidenceReferences.trim()
    );
    let newCurrencyAssessment: FunctionalCurrencyAssessment | undefined;
    if (hasCurrencyAssessmentInput) {
      const draft: FunctionalCurrencyAssessment = {
        id: 'fc-' + currentCompany.id + '-' + Date.now(),
        status: currencyAssessmentStatus,
        functionalCurrency: functionalCurrency as AccountingCurrencyCode,
        ...(functionalCurrency === 'OTHER' ? { functionalCurrencyOther: functionalCurrencyOther.trim() } : {}),
        presentationCurrency: presentationCurrency as AccountingCurrencyCode,
        ...(presentationCurrency === 'OTHER' ? { presentationCurrencyOther: presentationCurrencyOther.trim() } : {}),
        assessmentDate: currencyAssessmentDate, effectiveDate: currencyEffectiveDate,
        preparedBy: currencyPreparedBy.trim(),
        ...(currencyAssessmentStatus === 'APPROVED' ? { approvedBy: currencyApprovedBy.trim(), approvedAt: currencyApprovedAt } : {}),
        primaryEconomicEnvironment: primaryEconomicEnvironment.trim(),
        salesPriceFactors: salesPriceFactors.trim(), costFactors: costFactors.trim(),
        financingFactors: financingFactors.trim(), operatingReceiptsFactors: operatingReceiptsFactors.trim(),
        professionalConclusion: currencyProfessionalConclusion.trim(),
        evidenceReferences: currencyEvidenceReferences.split(String.fromCharCode(10)).map(item => item.trim()).filter(Boolean)
      };
      const currencyErrors = validateFunctionalCurrencyAssessment(draft);
      if (currencyErrors.length) {
        window.alert('No se guardó la evaluación NIC 21:' + String.fromCharCode(10) + '- ' + currencyErrors.join(String.fromCharCode(10) + '- '));
        return;
      }
      newCurrencyAssessment = draft;
    }

    const x = exchangeabilityDraft;
    const hasExchangeabilityInput = Boolean(
      x.measurementDate || x.purpose || x.currency || x.amountRequired || x.legalMechanism ||
      exchangeabilityInputs.amountRequired.trim() || exchangeabilityInputs.expectedDelayDays.trim() ||
      exchangeabilityInputs.amountAvailable.trim() || exchangeabilityInputs.accessibleSpotRate.trim() ||
      exchangeabilityInputs.estimatedSpotRate.trim() || x.estimationMethod || x.estimationEvidence ||
      x.preparedBy || x.approvedBy || x.approvedAt || exchangeabilityEvidence.trim()
    );
    let newExchangeabilityAssessment: ExchangeabilityAssessment | undefined;
    if (hasExchangeabilityInput) {
      const assessment: ExchangeabilityAssessment = {
        id: 'ex-' + currentCompany.id + '-' + Date.now(),
        measurementDate: String(x.measurementDate || ''),
        purpose: String(x.purpose || ''),
        currency: (x.currency || '') as AccountingCurrencyCode,
        ...(x.currency === 'OTHER' ? { currencyOther: String(x.currencyOther || '') } : {}),
        amountRequired: parseExchangeabilityNumber(exchangeabilityInputs.amountRequired || '0'),
        legalMechanism: String(x.legalMechanism || ''),
        legallyAccessible: x.legallyAccessible === true,
        actuallyAccessible: x.actuallyAccessible === true,
        ...(exchangeabilityInputs.expectedDelayDays.trim() ? { expectedDelayDays: Number(exchangeabilityInputs.expectedDelayDays) } : {}),
        ...(exchangeabilityInputs.amountAvailable.trim() ? { amountAvailable: parseExchangeabilityNumber(exchangeabilityInputs.amountAvailable) } : {}),
        ...(exchangeabilityInputs.accessibleSpotRate.trim() ? { accessibleSpotRate: parseExchangeabilityNumber(exchangeabilityInputs.accessibleSpotRate) } : {}),
        evidenceReferences: exchangeabilityEvidence.split(String.fromCharCode(10)).map(item => item.trim()).filter(Boolean),
        conclusion: (x.conclusion || 'NOT_CONVERTIBLE') as 'CONVERTIBLE' | 'NOT_CONVERTIBLE',
        ...(exchangeabilityInputs.estimatedSpotRate.trim() ? { estimatedSpotRate: parseExchangeabilityNumber(exchangeabilityInputs.estimatedSpotRate) } : {}),
        ...(x.estimationMethod ? { estimationMethod: String(x.estimationMethod) } : {}),
        ...(x.estimationEvidence ? { estimationEvidence: String(x.estimationEvidence) } : {}),
        preparedBy: String(x.preparedBy || ''),
        approvedBy: String(x.approvedBy || ''),
        approvedAt: String(x.approvedAt || '')
      };
      const exchangeabilityErrors = validateExchangeabilityAssessment(assessment);
      if (exchangeabilityErrors.length) {
        window.alert('No se guardó la evaluación de convertibilidad:' + String.fromCharCode(10) + '- ' + exchangeabilityErrors.join(String.fromCharCode(10) + '- '));
        return;
      }
      newExchangeabilityAssessment = assessment;
    }

    if (companySaveInFlightRef.current) return;
    companySaveInFlightRef.current = true;
    setCompanySaveBusy(true);
    try {
      updateCompany({
        ...currentCompany,
        ...(newCurrencyAssessment ? { functionalCurrencyAssessments: [...(currentCompany.functionalCurrencyAssessments || []), newCurrencyAssessment] } : {}),
        ...(newExchangeabilityAssessment ? { exchangeabilityAssessments: [...(currentCompany.exchangeabilityAssessments || []), newExchangeabilityAssessment] } : {}),
        name: name.trim().toUpperCase(),
        tradeName: tradeName.trim() || undefined,
        rif: rifValidation.formattedRif,
        taxpayerType,
        ...(hasSpecialNoticeMetadata ? { specialTaxpayerNotificationReference: specialTaxpayerNotificationReference.trim(), specialTaxpayerNotificationDate } : {}),
        ...(accountingFramework ? { accountingFramework, accountingFrameworkVersion: accountingFrameworkVersion.trim(), accountingFrameworkAdoptionDate } : {}),
        defaultIvaRetentionRate: taxpayerType === 'ESPECIAL' ? defaultIvaRetentionRate : 0,
        ivaRetentionAgentBasis,
        isPersonalFirm,
        isIgtfPerceptionAgent,
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        fiscalYear: Number(fiscalYear),
      });
      await waitForPersistence();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'SQLite no confirmó los parámetros de la empresa.');
    } finally {
      companySaveInFlightRef.current = false;
      setCompanySaveBusy(false);
    }
  };

  const handleExportBackup = () => {
    const jsonStr = exportBackupJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SICOVEN_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const confirmed = window.confirm(
      'RESTAURAR COPIA DE SEGURIDAD SICOVEN\n\nEsta operación reemplazará todas las empresas y sus datos contables actuales (asientos, compras, ventas, inventario, movimientos, retenciones, bancos y liquidaciones) por el contenido del archivo. No se puede deshacer.\n\n¿Deseas continuar?'
    );
    if (!confirmed) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async event => {
      const content = event.target?.result as string;
      if (!content) {
        alert('El archivo de respaldo está vacío o no se pudo leer.');
        return;
      }
      setBackupRestoreBusy(true);
      try {
        const ok = await restoreBackupJson(content);
        if (!ok) {
          alert('No se pudo validar el respaldo. No se confirmó la restauración.');
          return;
        }
        alert('¡Copia de seguridad restaurada y guardada correctamente en SQLite!');
      } catch (error) {
        console.error('No se pudo confirmar la restauración del respaldo en SQLite:', error);
        alert('La restauración no pudo confirmarse en SQLite. No continúe trabajando hasta revisar el estado de la base de datos.');
      } finally {
        setBackupRestoreBusy(false);
        input.value = '';
      }
    };
    reader.onerror = () => {
      input.value = '';
      alert('No se pudo leer el archivo de respaldo.');
    };
    reader.readAsText(file);
  };

  const handleCloseAccountingPeriod = async () => {
    if (!periodCloseDate) {
      alert('Seleccione la fecha hasta la cual desea cerrar la contabilidad.');
      return;
    }
    const confirmed = window.confirm(
      'CIERRE CONTABLE DEL PERÍODO\\n\\nSe bloquearán en SQLite las nuevas operaciones retroactivas con fecha igual o anterior a ' +
      periodCloseDate +
      '. El cierre no puede retrocederse desde esta pantalla; una reapertura requerirá un procedimiento formal y auditado.\\n\\n¿Confirma el cierre?'
    );
    if (!confirmed) return;
    setPeriodCloseBusy(true);
    try {
      await closeAccountingPeriod(periodCloseDate);
      alert('Cierre contable guardado y confirmado por SQLite hasta el ' + periodCloseDate + '.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'SQLite no confirmó el cierre contable. No continúe hasta revisar el estado de almacenamiento.');
    } finally {
      setPeriodCloseBusy(false);
    }
  };

  const handleReopenAccountingPeriod = async () => {
    if (!currentCompany.closedThroughDate) {
      setReopenError('No existe un cierre vigente para esta empresa.');
      return;
    }
    const reason = reopenReason.trim();
    if (reason.length < 10) {
      setReopenError('Explique el motivo de la reapertura con al menos 10 caracteres.');
      return;
    }
    const target = reopenThroughDate.trim() || null;
    const scope = target
      ? 'Se conservará el bloqueo hasta ' + target + ' y se habilitarán operaciones posteriores.'
      : 'Se reabrirá íntegramente el período, sin eliminar el registro histórico del cierre.';
    if (!window.confirm('REAPERTURA FORMAL DE PERÍODO\n\nEmpresa: ' + currentCompany.name +
        '\nCierre vigente: ' + currentCompany.closedThroughDate + '\n' + scope +
        '\n\nMotivo: ' + reason + '\n\nLa operación quedará registrada en la bitácora inmutable. ¿Confirma?')) return;
    setReopenBusy(true);
    setReopenError(null);
    try {
      await reopenAccountingPeriod(target, reason);
      setReopenReason('');
      alert('Reapertura confirmada por SQLite. El cierre original y su historial permanecen conservados.');
    } catch (error) {
      setReopenError(error instanceof Error ? error.message : 'SQLite no confirmó la reapertura.');
    } finally {
      setReopenBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Parámetros Globales
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-xs font-semibold text-slate-600">Multi-Empresa</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-1">
              Configuración del Sistema Contable
            </h1>
            <p className="text-xs text-slate-500 max-w-2xl mt-0.5">
              Gestión de empresas independientes, calificación SENIAT y respaldos de datos.
            </p>
          </div>

          <button
            onClick={() => setIsCompanyModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition shadow cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nueva Empresa
          </button>
        </div>

        {/* Multi-Company Selector Card List */}
        <div className="pt-6">
          <div className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
            Empresas Registradas en el Sistema ({companies.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {companies.map(c => {
              const isActive = c.id === currentCompany.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setCurrentCompanyId(c.id)}
                  className={`p-4 rounded-xl border transition cursor-pointer relative ${
                    isActive
                      ? 'border-emerald-500 bg-emerald-50/40 shadow-sm'
                      : 'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className="font-mono text-xs font-bold text-slate-700">{c.rif}</span>
                    </div>
                    {isActive && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                        <CheckCircle2 className="w-3 h-3" /> Activa
                      </span>
                    )}
                  </div>
                  <h4 className="font-bold text-xs text-slate-900 mt-2 truncate" title={c.name}>
                    {c.name}
                  </h4>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      c.taxpayerType === 'ESPECIAL' ? 'bg-purple-100 text-purple-800' : 'bg-sky-100 text-sky-800'
                    }`}>
                      {c.taxpayerType === 'ESPECIAL' ? 'Contribuyente Especial' : 'Contribuyente Ordinario'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Edit Active Company Details */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-base text-slate-900">
              Datos Fiscales de la Empresa Activa
            </h3>
            <p className="text-xs text-slate-500">
              {currentCompany.name} ({currentCompany.rif})
            </p>
          </div>
          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5" /> Cambios Guardados
            </span>
          )}
        </div>

        <form onSubmit={handleSaveCompany} className="pt-6 space-y-4 text-xs">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
            <label className="block font-bold text-slate-800">Marco contable VEN-NIF adoptado</label>
            <select value={accountingFramework} onChange={e => setAccountingFramework(e.target.value as AccountingFramework | '')} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
              <option value="">Sin adopción documentada / pendiente</option>
              <option value="VEN_NIF_GE">VEN-NIF GE — Grandes Entidades</option>
              <option value="VEN_NIF_PYME">VEN-NIF PYME — Pequeñas y Medianas Entidades</option>
            </select>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="block font-semibold text-slate-700 mb-1">Versión / referencia normativa</label><input value={accountingFrameworkVersion} onChange={e => setAccountingFrameworkVersion(e.target.value)} placeholder="Referencia realmente aplicada" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Fecha documentada de adopción</label><input type="date" value={accountingFrameworkAdoptionDate} onChange={e => setAccountingFrameworkAdoptionDate(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
            </div>
            <p className="text-[11px] text-slate-600">Los registros históricos sin esta información permanecen intactos. No se infiere ni se asigna una versión normativa automáticamente.</p>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-3">
            <div>
              <label className="block font-bold text-slate-800">Moneda funcional y de presentación — NIC 21</label>
              {(() => {
                const approved = (currentCompany.functionalCurrencyAssessments || []).filter(item => item.status === 'APPROVED').slice(-1)[0];
                return approved
                  ? <p className="mt-1 text-[11px] text-emerald-800">Última evaluación aprobada: funcional {approved.functionalCurrency === 'OTHER' ? approved.functionalCurrencyOther : approved.functionalCurrency}; presentación {approved.presentationCurrency === 'OTHER' ? approved.presentationCurrencyOther : approved.presentationCurrency}; vigente desde {approved.effectiveDate}.</p>
                  : <p className="mt-1 text-[11px] font-semibold text-amber-800">PENDIENTE DE EVALUACIÓN. No se presume moneda funcional ni se activa conversión automática.</p>;
              })()}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Moneda funcional propuesta</label><select value={functionalCurrency} onChange={e => setFunctionalCurrency(e.target.value as AccountingCurrencyCode | '')} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"><option value="">Sin determinar</option><option value="VES">VES — Bolívar</option><option value="USD">USD — Dólar</option><option value="EUR">EUR — Euro</option><option value="OTHER">Otra</option></select>{functionalCurrency === 'OTHER' && <input value={functionalCurrencyOther} onChange={e => setFunctionalCurrencyOther(e.target.value)} placeholder="Código y nombre de moneda" className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg" />}</div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Moneda de presentación</label><select value={presentationCurrency} onChange={e => setPresentationCurrency(e.target.value as AccountingCurrencyCode | '')} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"><option value="">Sin determinar</option><option value="VES">VES — Bolívar</option><option value="USD">USD — Dólar</option><option value="EUR">EUR — Euro</option><option value="OTHER">Otra</option></select>{presentationCurrency === 'OTHER' && <input value={presentationCurrencyOther} onChange={e => setPresentationCurrencyOther(e.target.value)} placeholder="Código y nombre de moneda" className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg" />}</div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Fecha de evaluación</label><input type="date" value={currencyAssessmentDate} onChange={e => setCurrencyAssessmentDate(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Fecha de vigencia propuesta</label><input type="date" value={currencyEffectiveDate} onChange={e => setCurrencyEffectiveDate(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Preparado por</label><input value={currencyPreparedBy} onChange={e => setCurrencyPreparedBy(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Estado del expediente</label><select value={currencyAssessmentStatus} onChange={e => setCurrencyAssessmentStatus(e.target.value as 'DRAFT' | 'APPROVED')} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"><option value="DRAFT">Borrador / revisión</option><option value="APPROVED">Aprobado</option></select></div>
              {currencyAssessmentStatus === 'APPROVED' && <><div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Aprobado por</label><input value={currencyApprovedBy} onChange={e => setCurrencyApprovedBy(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div><div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Fecha de aprobación</label><input type="date" value={currencyApprovedAt} onChange={e => setCurrencyApprovedAt(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div></>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Entorno económico principal</label><textarea value={primaryEconomicEnvironment} onChange={e => setPrimaryEconomicEnvironment(e.target.value)} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Factores de precios de venta</label><textarea value={salesPriceFactors} onChange={e => setSalesPriceFactors(e.target.value)} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Factores de costos</label><textarea value={costFactors} onChange={e => setCostFactors(e.target.value)} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Factores de financiación</label><textarea value={financingFactors} onChange={e => setFinancingFactors(e.target.value)} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Cobros y retención de efectivo operativo</label><textarea value={operatingReceiptsFactors} onChange={e => setOperatingReceiptsFactors(e.target.value)} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Conclusión del juicio profesional</label><textarea value={currencyProfessionalConclusion} onChange={e => setCurrencyProfessionalConclusion(e.target.value)} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
            </div>
            <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Referencias de evidencia (una por línea)</label><textarea value={currencyEvidenceReferences} onChange={e => setCurrencyEvidenceReferences(e.target.value)} rows={2} placeholder="Documento, contrato, extracto bancario, soporte..." className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
            <p className="text-[10px] text-slate-600">Cada evaluación se agrega al historial y no reemplaza las anteriores. Aprobar requiere preparador, aprobador, fechas, factores y evidencia. Esta captura no ejecuta conversiones ni altera asientos históricos.</p>
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3 space-y-3">
            <div>
              <label className="block font-bold text-slate-800">Convertibilidad — evaluación por fecha y propósito</label>
              {(() => {
                const latest = (currentCompany.exchangeabilityAssessments || []).slice(-1)[0];
                return latest
                  ? <p className="mt-1 text-[11px] text-slate-700">Última evaluación: {latest.conclusion === 'CONVERTIBLE' ? 'CONVERTIBLE' : 'NO CONVERTIBLE'} para {latest.purpose}, fecha {latest.measurementDate}.</p>
                  : <p className="mt-1 text-[11px] font-semibold text-amber-800">Sin evaluación registrada. La tasa BCV no se presume accesible para cada propósito.</p>;
              })()}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Fecha de medición</label><input type="date" value={String(exchangeabilityDraft.measurementDate || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, measurementDate: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Propósito concreto</label><input value={String(exchangeabilityDraft.purpose || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, purpose: e.target.value }))} placeholder="Ej. pagar proveedor extranjero" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Moneda requerida</label><select value={String(exchangeabilityDraft.currency || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, currency: e.target.value as AccountingCurrencyCode }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"><option value="">Seleccione</option><option value="VES">VES</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="OTHER">Otra</option></select>{exchangeabilityDraft.currency === 'OTHER' && <input value={String(exchangeabilityDraft.currencyOther || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, currencyOther: e.target.value }))} placeholder="Código de moneda" className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg" />}</div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Monto que se necesita convertir</label><input type="text" inputMode="decimal" value={exchangeabilityInputs.amountRequired} onChange={e => setExchangeabilityInputs(p => ({ ...p, amountRequired: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div className="sm:col-span-2"><label className="block text-[11px] font-semibold text-slate-700 mb-1">Mecanismo legal evaluado</label><textarea value={String(exchangeabilityDraft.legalMechanism || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, legalMechanism: e.target.value }))} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">¿Legalmente accesible?</label><select value={String(exchangeabilityDraft.legallyAccessible)} onChange={e => setExchangeabilityDraft(p => ({ ...p, legallyAccessible: e.target.value === 'true' }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"><option value="false">No / no acreditado</option><option value="true">Sí, con evidencia</option></select></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">¿Acceso efectivo para la entidad?</label><select value={String(exchangeabilityDraft.actuallyAccessible)} onChange={e => setExchangeabilityDraft(p => ({ ...p, actuallyAccessible: e.target.value === 'true' }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"><option value="false">No / no acreditado</option><option value="true">Sí, probado</option></select></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Plazo estimado (días)</label><input type="text" inputMode="numeric" value={exchangeabilityInputs.expectedDelayDays} onChange={e => setExchangeabilityInputs(p => ({ ...p, expectedDelayDays: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Conclusión</label><select value={String(exchangeabilityDraft.conclusion || 'NOT_CONVERTIBLE')} onChange={e => setExchangeabilityDraft(p => ({ ...p, conclusion: e.target.value as 'CONVERTIBLE' | 'NOT_CONVERTIBLE' }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"><option value="CONVERTIBLE">Convertible</option><option value="NOT_CONVERTIBLE">No convertible</option></select></div>
              {exchangeabilityDraft.conclusion === 'CONVERTIBLE' ? <>
                <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Monto realmente disponible</label><input type="text" inputMode="decimal" value={exchangeabilityInputs.amountAvailable} onChange={e => setExchangeabilityInputs(p => ({ ...p, amountAvailable: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
                <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Tasa spot accesible</label><input type="text" inputMode="decimal" value={exchangeabilityInputs.accessibleSpotRate} onChange={e => setExchangeabilityInputs(p => ({ ...p, accessibleSpotRate: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              </> : <>
                <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Tasa spot estimada</label><input type="text" inputMode="decimal" value={exchangeabilityInputs.estimatedSpotRate} onChange={e => setExchangeabilityInputs(p => ({ ...p, estimatedSpotRate: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
                <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Metodología de estimación</label><textarea value={String(exchangeabilityDraft.estimationMethod || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, estimationMethod: e.target.value }))} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
                <div className="sm:col-span-2"><label className="block text-[11px] font-semibold text-slate-700 mb-1">Evidencia de la estimación</label><textarea value={String(exchangeabilityDraft.estimationEvidence || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, estimationEvidence: e.target.value }))} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              </>}
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Preparado por</label><input value={String(exchangeabilityDraft.preparedBy || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, preparedBy: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Aprobado por</label><input value={String(exchangeabilityDraft.approvedBy || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, approvedBy: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
              <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Fecha de aprobación</label><input type="date" value={String(exchangeabilityDraft.approvedAt || '')} onChange={e => setExchangeabilityDraft(p => ({ ...p, approvedAt: e.target.value }))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
            </div>
            <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">Referencias documentales (una por línea)</label><textarea value={exchangeabilityEvidence} onChange={e => setExchangeabilityEvidence(e.target.value)} rows={2} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" /></div>
            <p className="text-[10px] text-slate-600">Cada conclusión queda vinculada a una fecha, propósito y monto. No se infiere acceso a divisas por la tasa oficial y esta evaluación no ejecuta conversión contable.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700">RIF Oficial</label>
                <span className="text-[10px] text-slate-400 font-mono">[V,J,G,E,P]</span>
              </div>
              <input
                type="text"
                required
                value={rif}
                onChange={handleRifChange}
                onBlur={handleRifBlur}
                maxLength={14}
                className={`w-full px-3 py-1.5 border rounded-lg font-mono uppercase focus:outline-none transition ${
                  rifError
                    ? 'border-rose-400 bg-rose-50/40 text-rose-900 focus:ring-1 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-1 focus:ring-emerald-500'
                }`}
              />
              {rifError && (
                <p className="mt-1 text-[11px] text-rose-600 flex items-start gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{rifError}</span>
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Razón Social</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg uppercase focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Calificación SENIAT</label>
              <select
                value={taxpayerType}
                onChange={e => {
                  const val = e.target.value as TaxpayerType;
                  setTaxpayerType(val);
                  if (val === 'ORDINARIO') { setDefaultIvaRetentionRate(0); setIsPersonalFirm(false); if (ivaRetentionAgentBasis === 'ARTICLE_1_SPECIAL_DESIGNATED' || ivaRetentionAgentBasis === 'ARTICLE_1_AND_2') setIvaRetentionAgentBasis('UNCONFIRMED'); }
                  else if (defaultIvaRetentionRate === 0) setDefaultIvaRetentionRate(75);
                }}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-semibold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="ESPECIAL">Contribuyente Especial (con notificación SENIAT)</option>
                <option value="ORDINARIO">Contribuyente Ordinario</option>
              </select>
            </div>
            {taxpayerType === 'ESPECIAL' && (
              <div className="sm:col-span-3 rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-2">
                <label className="block font-semibold text-slate-800">Notificación expresa del SENIAT</label>
                <input value={specialTaxpayerNotificationReference} onChange={e => setSpecialTaxpayerNotificationReference(e.target.value)} placeholder="Número o referencia de la notificación" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                <input type="date" value={specialTaxpayerNotificationDate} onChange={e => setSpecialTaxpayerNotificationDate(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                <p className="text-[11px] text-slate-600">La condición debe estar respaldada por notificación expresa. Los registros históricos especiales sin estos metadatos se conservan; para nuevas calificaciones, complete ambos datos.</p>
              </div>
            )}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Retención IVA por Defecto</label>
              <select
                disabled={taxpayerType !== 'ESPECIAL'}
                value={defaultIvaRetentionRate}
                onChange={e => setDefaultIvaRetentionRate(Number(e.target.value))}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-50 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value={75}>75% (General)</option>
                <option value={100}>100%</option>
                <option value={0}>0%</option>
              </select>
            </div>
            <div className="sm:col-span-3 rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-2">
              <label className="block font-semibold text-slate-800">Condición como agente de retención de IVA — Providencia SNAT/2025/000054</label>
              <select value={ivaRetentionAgentBasis} onChange={e => setIvaRetentionAgentBasis(e.target.value as IvaRetentionAgentBasis)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold">
                <option value="UNCONFIRMED">Pendiente de confirmar</option>
                <option value="ARTICLE_1_SPECIAL_DESIGNATED" disabled={taxpayerType !== 'ESPECIAL'}>Artículo 1 — Sujeto especial calificado y notificado</option>
                <option value="ARTICLE_2_METALS">Artículo 2 — Comprador habitual de metales o piedras preciosas</option>
                <option value="ARTICLE_1_AND_2" disabled={taxpayerType !== 'ESPECIAL'}>Artículos 1 y 2 — Sujeto especial y comprador habitual de metales o piedras preciosas</option>
                <option value="NOT_AGENT">No es agente de retención bajo esta Providencia</option>
              </select>
              <p className="text-[11px] text-slate-600">La calificación de contribuyente especial por sí sola no sustituye la confirmación de la designación. Si queda pendiente, SICOVEN dejará la retención en revisión.</p>
              {['ARTICLE_1_SPECIAL_DESIGNATED', 'ARTICLE_1_AND_2'].includes(ivaRetentionAgentBasis) && /^[VEP]/.test(rif.replace(/[^A-Z0-9]/gi, '')) && (
                <label className="flex items-start gap-2 text-xs text-slate-800">
                  <input type="checkbox" checked={isPersonalFirm} onChange={e => setIsPersonalFirm(e.target.checked)} className="mt-0.5" />
                  <span><strong>La persona natural está constituida como firma personal</strong><span className="block text-[11px] text-slate-600 mt-1">La Providencia incluye a personas naturales especiales únicamente cuando actúan como firma personal.</span></span>
                </label>
              )}
            </div>
            <div className="sm:col-span-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <label className="flex items-start gap-2 text-sm text-slate-800 cursor-pointer">
                <input type="checkbox" checked={isIgtfPerceptionAgent} onChange={e => setIsIgtfPerceptionAgent(e.target.checked)} className="mt-0.5" />
                <span><strong>Empresa designada agente de percepción del IGTF</strong><span className="block text-xs text-slate-600 mt-1">Actívelo únicamente si la designación aplica legalmente a esta empresa. Este parámetro habilita el cálculo en las facturas elegibles.</span></span>
              </label>
            </div></div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Dirección Fiscal Completa</label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Teléfono</label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Correo Electrónico</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-200">
            <button
              type="submit"
              disabled={companySaveBusy}
              className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 disabled:opacity-40 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {companySaveBusy ? "Confirmando SQLite..." : "Guardar Parámetros de Empresa"}
            </button>
          </div>
        </form>
      </div>

      {/* Cierre contable y control de períodos */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-2">
            <LockKeyhole className="w-5 h-5 text-amber-700" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm text-slate-900">Cierre contable y bloqueo de períodos</h3>
            <p className="text-xs text-slate-500 mt-1">
              El cierre se registra en SQLite para esta empresa. Las nuevas operaciones retroactivas hasta la fecha cerrada serán rechazadas en la persistencia local.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Cerrar operaciones hasta</label>
            <input
              type="date"
              value={periodCloseDate}
              min={currentCompany.closedThroughDate || undefined}
              max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}
              onChange={e => setPeriodCloseDate(e.target.value)}
              disabled={periodCloseBusy || !isStorageReady}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100"
            />
          </div>
          <button
            type="button"
            onClick={handleCloseAccountingPeriod}
            disabled={periodCloseBusy || !isStorageReady || !periodCloseDate}
            className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarCheck className="w-4 h-4" />
            {periodCloseBusy ? 'Confirmando en SQLite…' : currentCompany.closedThroughDate ? 'Actualizar fecha de cierre' : 'Cerrar período'}
          </button>
        </div>
        <div className={`rounded-lg border p-3 text-xs ${currentCompany.closedThroughDate ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
          {currentCompany.closedThroughDate
            ? <><strong>Cierre vigente:</strong> operaciones hasta {currentCompany.closedThroughDate}. La fecha solo puede avanzarse desde esta pantalla.</>
            : <><strong>Sin cierre registrado.</strong> La empresa todavía no tiene un período bloqueado.</>}
        </div>
        {currentCompany.closedThroughDate && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 space-y-3">
            <div>
              <h4 className="text-xs font-bold text-rose-900">Reapertura formal y auditada</h4>
              <p className="mt-1 text-[11px] text-rose-800">
                Exclusiva del administrador autenticado. La fecha indicada será el nuevo límite de cierre; déjela vacía para reabrir todo el período. El cierre original nunca se elimina.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mantener cerrado hasta (opcional)</label>
                <input
                  type="date"
                  value={reopenThroughDate}
                  max={(() => {
                    const date = new Date(currentCompany.closedThroughDate + 'T00:00:00.000Z');
                    date.setUTCDate(date.getUTCDate() - 1);
                    return date.toISOString().slice(0, 10);
                  })()}
                  onChange={e => setReopenThroughDate(e.target.value)}
                  disabled={reopenBusy || !isStorageReady}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100"
                />
                <p className="mt-1 text-[10px] text-slate-500">Vacío = reapertura integral desde el inicio del historial.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Motivo obligatorio y soporte de referencia</label>
                <textarea
                  value={reopenReason}
                  onChange={e => setReopenReason(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  disabled={reopenBusy || !isStorageReady}
                  placeholder="Describa el error detectado, autorización y documento de soporte…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-100"
                />
              </div>
            </div>
            {reopenError && <p role="alert" className="rounded-lg border border-rose-300 bg-white p-2 text-xs text-rose-800">{reopenError}</p>}
            <button
              type="button"
              onClick={handleReopenAccountingPeriod}
              disabled={reopenBusy || !isStorageReady || reopenReason.trim().length < 10}
              className="rounded-lg bg-rose-700 hover:bg-rose-800 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reopenBusy ? 'Registrando reapertura en SQLite…' : 'Autorizar y registrar reapertura'}
            </button>
          </div>
        )}
        {!isStorageReady && <p className="text-xs text-rose-700">El almacenamiento SQLite no está disponible. El cierre permanece deshabilitado.</p>}
      </div>

      {/* Preparación y registro controlado del asiento de apertura */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-2">
            <CalendarCheck className="w-5 h-5 text-indigo-700" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm text-slate-900">Apertura del siguiente ejercicio</h3>
            <p className="text-xs text-slate-500 mt-1">
              Prepara los saldos patrimoniales y el resultado del ejercicio cerrado. La apertura solo se registra después de revisar la vista previa y confirmar; no se genera automáticamente.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Inicio del ejercicio</label>
            <input type="date" value={openingPeriodStart} onChange={e => { setOpeningPeriodStart(e.target.value); setOpeningPreview(null); setOpeningError(null); }} disabled={openingBusy || !isStorageReady} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Cierre del ejercicio</label>
            <input type="date" value={openingPeriodEnd} onChange={e => { setOpeningPeriodEnd(e.target.value); setOpeningPreview(null); setOpeningError(null); }} disabled={openingBusy || !isStorageReady || Boolean(currentCompany.closedThroughDate)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Fecha de apertura</label>
            <input type="date" value={openingDate} onChange={e => { setOpeningDate(e.target.value); setOpeningPreview(null); setOpeningError(null); }} disabled={openingBusy || !isStorageReady} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tasa BCV histórica (Bs./USD) *</label>
            <input type="text" inputMode="decimal" value={openingBcvRateInput} onChange={e => { setOpeningBcvRateInput(e.target.value); setOpeningError(null); }} disabled={openingBusy || !isStorageReady} placeholder="Ej.: 889,67" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Cuenta patrimonial para resultado</label>
            <select value={retainedEarningsAccountCode} onChange={e => { setRetainedEarningsAccountCode(e.target.value); setOpeningPreview(null); setOpeningError(null); }} disabled={openingBusy || !isStorageReady} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">Seleccionar si hay resultado del ejercicio</option>
              {accounts.filter(account => account.type === 'PATRIMONIO' && account.isMovement).map(account => (
                <option key={account.code} value={account.code}>{account.code} — {account.name}</option>
              ))}
            </select>
          </div>
        </div>
        {!currentCompany.closedThroughDate && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Para preparar la apertura, primero debe existir un cierre contable confirmado en SQLite para esta empresa.
          </p>
        )}
        {openingError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{openingError}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handlePreviewOpening} disabled={openingBusy || !isStorageReady || !currentCompany.closedThroughDate} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            Preparar vista previa
          </button>
          <button type="button" onClick={handlePostOpening} disabled={openingBusy || !openingPreview || !isStorageReady || parseExchangeabilityNumber(openingBcvRateInput) <= 0} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {openingBusy ? 'Guardando y verificando SQLite…' : 'Confirmar y registrar apertura'}
          </button>
        </div>
        {openingPreview && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-bold text-slate-800">Vista previa — {openingPreview.length} líneas</p>
              <p className="text-[11px] text-slate-500">No se ha contabilizado todavía. Revise ambas monedas antes de confirmar.</p>
            </div>
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Cuenta</th>
                  <th className="px-3 py-2 text-right">Debe Bs.</th>
                  <th className="px-3 py-2 text-right">Haber Bs.</th>
                  <th className="px-3 py-2 text-right">Debe USD</th>
                  <th className="px-3 py-2 text-right">Haber USD</th>
                </tr>
              </thead>
              <tbody>
                {openingPreview.map(item => (
                  <tr key={item.accountCode} className="border-t border-slate-100">
                    <td className="px-3 py-2"><span className="font-mono">{item.accountCode}</span> — {item.accountName}</td>
                    <td className="px-3 py-2 text-right font-mono">{item.debitBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right font-mono">{item.creditBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right font-mono">{item.debitUsd.toFixed(6)}</td>
                    <td className="px-3 py-2 text-right font-mono">{item.creditUsd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <tr>
                  <td className="px-3 py-2">Totales</td>
                  <td className="px-3 py-2 text-right font-mono">{openingPreview.reduce((sum, item) => sum + item.debitBs, 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-right font-mono">{openingPreview.reduce((sum, item) => sum + item.creditBs, 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-right font-mono">{openingPreview.reduce((sum, item) => sum + item.debitUsd, 0).toFixed(6)}</td>
                  <td className="px-3 py-2 text-right font-mono">{openingPreview.reduce((sum, item) => sum + item.creditUsd, 0).toFixed(6)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {!isStorageReady && <p className="text-xs text-rose-700">SQLite no está disponible. La preparación y el registro permanecen deshabilitados.</p>}
      </div>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Importador Inteligente Universal</h2>
          <p className="mt-1 text-sm text-slate-600">Un solo centro para analizar archivos JSON, CSV, TSV, TXT y Excel XLSX/XLSM de POSVEN u otros sistemas. Detecta colecciones, muestra vista previa y ejecuta únicamente módulos con adaptadores validados, con empresa destino explícita y confirmación antes de escribir en SQLite.</p>
        </div>
        <button type="button" onClick={() => setShowUniversalMigrationWizard(true)} disabled={!isStorageReady} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
          <Upload className="h-4 w-4" /> Abrir importador universal
        </button>
        {!isStorageReady && <p className="text-xs text-rose-700">SQLite no está disponible. El importador permanece deshabilitado para proteger los datos.</p>}
      </section>
      {showUniversalMigrationWizard && <IntelligentMigrationWizard onClose={() => setShowUniversalMigrationWizard(false)} />}

      {/* Normativas Legales y Respaldo de Información */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Normativas Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-3">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <Scale className="w-4 h-4 text-emerald-600" />
            Normas Legales y Tributarias Integradas
          </div>
          <div className="space-y-2.5 text-xs text-slate-600">
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <strong className="text-slate-800 block">SENIAT Providencia SNAT/2015/0049:</strong>
              Régimen de Retenciones de IVA para Contribuyentes Especiales (75% y 100%), emisión de comprobantes de 14 caracteres y archivo TXT delimitado por tabuladores.
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <strong className="text-slate-800 block">Decreto Presidencial 1.808 (ISLR):</strong>
              Retenciones en fuente de Impuesto sobre la Renta para personas naturales (con sustraendo) y personas jurídicas (honorarios 5%, fletes 2%, adquisición bienes 2%).
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <strong className="text-slate-800 block">Normas VEN-NIF (FCCPV):</strong>
              Principios de contabilidad de aceptación general en Venezuela: NIC 1 (Presentación), NIC 2 (Inventarios al costo promedio ponderado), NIC 21 (Moneda extranjera a tasa oficial BCV).
            </div>
          </div>
        </div>

        {/* Respaldo y Mantenimiento Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <Download className="w-4 h-4 text-indigo-600" />
            Respaldo y Seguridad de Datos
          </div>
          <p className="text-xs text-slate-500">
            Exporta o restaura toda la contabilidad (asientos, compras, ventas, inventarios, retenciones) en formato JSON estructurado.
          </p>

          <div className="space-y-2.5 pt-1">
            <button
              onClick={handleExportBackup}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Descargar Respaldo JSON Completo
            </button>

            <label className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold border border-slate-300 transition cursor-pointer">
              <Upload className="w-4 h-4" />
              {backupRestoreBusy ? 'Restaurando y verificando SQLite…' : 'Restaurar desde Archivo JSON'}
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                  disabled={backupRestoreBusy}
                className="hidden"
              />
            </label>

            <button
              disabled={factoryResetBusy}
              onClick={async () => {
                if (!confirm('¿Restablecer el sistema a los datos de muestra iniciales? Se sobrescribirán los datos actuales.')) return;
                setFactoryResetBusy(true);
                setFactoryResetStage('Guardando restablecimiento en SQLite…');
                try {
                  await resetToSampleData();
                  alert('SQLite confirmó el restablecimiento a los datos de prueba oficiales.');
                } catch (error) {
                  alert(error instanceof Error ? error.message : 'No se pudo confirmar el restablecimiento en SQLite.');
                } finally {
                  setFactoryResetBusy(false);
                  setFactoryResetStage('');
                }
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />
              {factoryResetBusy ? 'Confirmando SQLite…' : 'Restablecer a Datos de Prueba Oficiales'}
            </button>

            <button
              disabled={factoryResetBusy}
              onClick={async () => {
                const first = window.confirm('RESET DE FÁBRICA SICOVEN\\n\\nSe eliminarán los registros operativos: asientos, compras, ventas, inventario, movimientos, retenciones, conciliaciones, liquidaciones y cuentas bancarias operativas. Se eliminarán todas las empresas registradas y sus parámetros, junto con todos los registros operativos. Se conservarán el acceso administrativo y la licencia/prueba actual. Esta acción no se puede deshacer. ¿Deseas continuar?');
                if (!first) return;
                setFactoryResetBusy(true);
                setFactoryResetStage('Verificando sesión y preparando el reinicio…');
                try {
                  setFactoryResetStage('Eliminando datos operativos y empresas de SQLite…');
                  await resetFactoryData();
                  setFactoryResetStage('Verificación completada. Datos operativos eliminados.');
                  alert('Reinicio de fábrica verificado: se eliminaron las empresas y los datos operativos. Se conservaron usuarios, licencia y valores predeterminados del sistema.');
                } catch (error) {
                  alert(error instanceof Error ? error.message : 'No se pudo completar el reset. No se confirmó el borrado.');
                } finally { setFactoryResetBusy(false); setFactoryResetStage(''); }
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-60"
            >
              <RotateCcw className="w-4 h-4" />
              {factoryResetBusy ? 'Restableciendo SQLite…' : 'Reset de fábrica: borrar datos operativos'}
            </button>
            {factoryResetBusy && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4" role="status" aria-live="polite">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-rose-900">{factoryResetStage || 'Restableciendo el sistema…'}</span>
                  <span className="text-[10px] font-bold text-rose-700">EN CURSO</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-rose-100">
                  <div className="h-full w-2/5 animate-pulse rounded-full bg-rose-600" />
                </div>
                <p className="mt-2 text-[10px] text-rose-800">No cierre SICOVEN hasta que termine la verificación de SQLite.</p>
              </div>
            )}

          </div>
        </div>
      </div>

      <CompanyModal isOpen={isCompanyModalOpen} onClose={() => setIsCompanyModalOpen(false)} /></div>
  );
};
