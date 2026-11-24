import type { BankMovementType } from './accounting';
import { validateBankMovementFxSnapshot } from './bankStatementMatching';
import { isBcvRateRequiredForDate } from '../utils/bcvRatePolicy';

export type BankStatementCurrency = 'BS' | 'USD';
export interface BankStatementImportCandidate {
  rowNumber: number;
  date: string;
  reference: string;
  description: string;
  type: BankMovementType;
  currency: BankStatementCurrency;
  amountBs: number;
  amountUsd: number;
  bcvRate: number;
  bcvRateEffectiveDate: string;
  errors: string[];
}
export type BankStatementRawRow = Record<string, unknown>;

const normalizeHeader = (value: unknown) => String(value ?? '').replace(String.fromCharCode(65279),'').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const aliases: Record<string,string[]> = {
  date:['fecha','date','fecha_movimiento','transaction_date','dtposted'],
  reference:['referencia','reference','ref','numero_referencia','nro_referencia','fitid','checknum'],
  description:['descripcion','description','concepto','memo','name','payee'],
  type:['tipo','type','naturaleza','debit_credit','trntype'],
  amount:['monto','amount','importe','valor','transaction_amount'],
  currency:['moneda','currency','divisa','curdef'],
  bcvRate:['tasa_bcv','bcv_rate','tasa','exchange_rate','bcvrate'],
  bcvRateEffectiveDate:['fecha_vigencia_bcv','bcv_rate_date','exchange_rate_date','fecha_tasa','bcvrate_effective_date','bcvrateeffectivedate']
};
const pick = (row: BankStatementRawRow, field: string): unknown => {
  const entries = Object.entries(row);
  const found = entries.find(([key]) => aliases[field]?.includes(normalizeHeader(key)));
  return found?.[1];
};
const decimal = (value: unknown): number => {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').trim().replace(/\s/g,'');
  if (!raw) return NaN;
  const comma=raw.lastIndexOf(','),dot=raw.lastIndexOf('.');
  const normalized=comma>=0&&dot>=0
    ? (comma>dot?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,''))
    : comma>=0?raw.replace(/\./g,'').replace(',','.')
    : raw;
  return Number(normalized);
};
const isoDate = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0,10);
  const raw=String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m=raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : raw;
};
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

export function parseBankStatementCsv(source: string): BankStatementRawRow[] {
  const input = source.replace(/^\uFEFF/, '');
  const delimiters = ['\t', ';', '|', ','];
  const parseWithDelimiter = (delimiter: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    let quoteClosed = false;
    const finishCell = () => { row.push(cell); cell = ''; quoteClosed = false; };
    const finishRow = () => { finishCell(); if (row.some(value => value.trim() !== '')) rows.push(row); row = []; };
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"') {
          if (input[i + 1] === '"') { cell += '"'; i++; }
          else { quoted = false; quoteClosed = true; }
        } else cell += ch;
      } else if (quoteClosed) {
        if (ch === delimiter) finishCell();
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && input[i + 1] === '\n') i++;
          finishRow();
        } else if (ch !== ' ' && ch !== '\t') {
          throw new Error('El extracto contiene caracteres inválidos después de cerrar un campo entre comillas.');
        }
      } else if (ch === delimiter) finishCell();
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && input[i + 1] === '\n') i++;
        finishRow();
      } else if (ch === '"') {
        if (cell.trim() !== '') throw new Error('El extracto contiene comillas en una posición inválida.');
        cell = '';
        quoted = true;
      } else cell += ch;
    }
    if (quoted) throw new Error('El extracto contiene comillas sin cerrar.');
    finishCell();
    if (row.some(value => value.trim() !== '')) rows.push(row);
    return rows;
  };
  const candidates = delimiters.map(delimiter => {
    try {
      const rows = parseWithDelimiter(delimiter);
      const width = rows[0]?.length ?? 0;
      const consistentRows = rows.filter(row => row.length === width).length;
      return { delimiter, rows, score: width > 1 ? consistentRows * 100 + width : 0 };
    } catch (error) {
      return { delimiter, rows: [] as string[][], score: -1, error };
    }
  }).sort((a,b)=>b.score-a.score);
  const parsed = candidates.find(candidate => candidate.score >= 0 && candidate.rows.length >= 2 && candidate.rows[0].length >= 2 && (() => {
    const candidateHeaders = candidate.rows[0].map(normalizeHeader);
    return candidateHeaders.some(header => aliases.date.includes(header)) && candidateHeaders.some(header => aliases.amount.includes(header));
  })());
  if (!parsed) {
    // Select the parse error from the delimiter most strongly indicated by the header,
    // rather than letting a failed attempt with an unrelated delimiter mask the real CSV error.
    const headerLine = input.split(/\r?\n/, 1)[0] || '';
    const errorCandidates = candidates.filter(candidate => candidate.score < 0 && candidate.error instanceof Error);
    const bestError = errorCandidates.sort((a, b) =>
      headerLine.split(b.delimiter).length - headerLine.split(a.delimiter).length
    )[0]?.error;
    if (bestError instanceof Error) throw bestError;
    throw new Error('El archivo delimitado no contiene encabezados y movimientos válidos.');
  }
  const headers = parsed.rows[0].map(normalizeHeader);
  if (!headers.some(h=>aliases.date.includes(h))||!headers.some(h=>aliases.amount.includes(h))) {
    throw new Error('El archivo delimitado debe incluir columnas de fecha e importe.');
  }
  const inconsistent = parsed.rows.slice(1).findIndex(values => values.length !== headers.length);
  if (inconsistent !== -1) throw new Error('El extracto contiene filas con un número de columnas diferente al encabezado.');
  return parsed.rows.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??''])));
}

/** TXT delimitado: admite tabulador, punto y coma, barra vertical o coma, con encabezados. */
export function parseBankStatementTxt(source: string): BankStatementRawRow[] {
  return parseBankStatementCsv(source.replace(/^\uFEFF/, ''));
}

export function normalizeBankStatementRows(rows: BankStatementRawRow[], defaultCurrency: BankStatementCurrency): BankStatementImportCandidate[] {
  return rows.map((row,index)=>{
    const errors:string[]=[];
    const date=isoDate(pick(row,'date'));
    const reference=String(pick(row,'reference')??'').trim();
    const description=String(pick(row,'description')??'').trim();
    const rawType=normalizeHeader(pick(row,'type')).toUpperCase();
    const rawAmount=decimal(pick(row,'amount'));
    const rawCurrencyValue=String(pick(row,'currency')??'').trim();
    const hasCurrency=rawCurrencyValue!=='';
    const currencyRaw=normalizeHeader(hasCurrency?rawCurrencyValue:defaultCurrency).toUpperCase();
    const currency:BankStatementCurrency=/^(USD|US|DOLAR|DOLARES)$/.test(currencyRaw)?'USD':'BS';
    if(hasCurrency&&!/^(USD|US|DOLAR|DOLARES|BS|VES|VEF|BOLIVAR|BOLIVARES)$/.test(currencyRaw))errors.push('Moneda no reconocida.');
    const rawRate=decimal(pick(row,'bcvRate'));
    const rate=Number.isFinite(rawRate)&&rawRate>0?rawRate:0;
    const rateDate=isoDate(pick(row,'bcvRateEffectiveDate'));
    const debitType=/^(DEBIT|DEBITO|D|DB|PAYMENT|WITHDRAWAL|CARGO|EGRESO|SALIDA|CHECK|FEE)$/.test(rawType);
    const creditType=/^(CREDIT|CREDITO|C|CR|DEPOSITO|ABONO|INGRESO|DIRECTDEP)$/.test(rawType);
    if(!rawType)errors.push('Falta la naturaleza del movimiento; indique Débito o Crédito.');
    else if(!debitType&&!creditType)errors.push('Naturaleza no reconocida; use Débito o Crédito.');
    // The sign is not a reliable substitute for TRNTYPE/nature; invalid or missing labels remain rejected below.
    const type:BankMovementType=debitType?'DEBIT':'CREDIT';
    const amount=Math.abs(rawAmount);
    if(!validDate(date))errors.push('Fecha inválida.');
    if(!reference)errors.push('Falta la referencia.');
    if(!description)errors.push('Falta la descripción.');
    if(!Number.isFinite(rawAmount)||amount<=0)errors.push('Importe inválido o no positivo.');
    if(rate<=0&&isBcvRateRequiredForDate(date))errors.push('Falta una tasa BCV positiva y su fecha de vigencia BCV para movimientos desde 2018.');
    if(rate>0&&(!validDate(rateDate)||rateDate>date))errors.push('Fecha de vigencia BCV inválida o posterior al movimiento.');
    if(rate<=0&&rateDate)errors.push('No indique fecha de vigencia BCV sin una tasa.');
    const amountBs=currency==='USD'?(rate>0?Math.round(amount*rate*100)/100:0):Math.round(amount*100)/100;
    const amountUsd=currency==='USD'?Math.round(amount*1_000_000)/1_000_000:(rate>0?Math.round(amount/rate*1_000_000)/1_000_000:0);
    if(errors.length===0){
      try{validateBankMovementFxSnapshot({date,amountBs,amountUsd,bcvRate:rate,bcvRateEffectiveDate:rateDate});}
      catch(error){errors.push(error instanceof Error?error.message:'Snapshot cambiario inválido.');}
    }
    return {rowNumber:index+2,date,reference,description,type,currency,amountBs,amountUsd,bcvRate:rate,bcvRateEffectiveDate:rateDate,errors};
  });
}

export function parseOfxBankStatement(source: string): { currency: BankStatementCurrency; rows: BankStatementRawRow[] } {
  const currencyTag=source.match(/<CURDEF>\s*([A-Z]{3})/i)?.[1]?.toUpperCase()||'';
  if(!['USD','VES','VEF'].includes(currencyTag))throw new Error('El OFX debe declarar CURDEF USD, VES o VEF.');
  const currency:BankStatementCurrency=currencyTag==='USD'?'USD':'BS';
  const startTags=[...source.matchAll(/<STMTTRN>/gi)];
  if(!startTags.length)throw new Error('El OFX no contiene movimientos STMTTRN.');
  const blocks=startTags.map((match,index)=>{
    const blockStart=(match.index||0)+match[0].length;
    const nextStart=startTags[index+1]?.index??source.length;
    const closing=source.toUpperCase().indexOf('</BANKTRANLIST>',blockStart);
    const blockEnd=closing>=0&&closing<nextStart?closing:nextStart;
    return source.slice(blockStart,blockEnd);
  });
  const rows=blocks.map(block=>{
    const tag=(name:string)=>block.match(new RegExp('<'+name+'>([^\\r\\n<]+)','i'))?.[1]?.trim()||'';
    const amount=Number(tag('TRNAMT'));
    const type=tag('TRNTYPE').toUpperCase();
    const rate=Number(tag('EXCHANGERATE'));
    const rateDate=tag('EXCHANGERATEDATE');
    return {date:tag('DTPOSTED').slice(0,8).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),reference:tag('FITID')||tag('CHECKNUM'),description:tag('NAME')||tag('MEMO'),type,amount:Math.abs(amount),currency,bcvRate:rate,bcvRateEffectiveDate:rateDate.slice(0,10).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')};
  });
  return {currency,rows};
}

/** Reads the first worksheet; row one is the header row. */
export async function parseBankStatementXlsx(buffer: ArrayBuffer): Promise<BankStatementRawRow[]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) throw new Error('El Excel no contiene encabezado y movimientos.');
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, column) => { headers[column - 1] = normalizeHeader(cell.text || cell.value); });
  if (!headers.some(h => aliases.date.includes(h)) || !headers.some(h => aliases.amount.includes(h))) {
    throw new Error('El Excel debe incluir columnas de fecha e importe en la primera hoja.');
  }
  const rows: BankStatementRawRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const record: BankStatementRawRow = {};
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      const value = cell.value;
      record[headers[column - 1] || String(column)] =
        value && typeof value === 'object' && 'text' in value ? String((value as { text: string }).text) :
        value && typeof value === 'object' && 'result' in value ? (value as { result: unknown }).result :
        value;
    });
    if (Object.values(record).some(value => String(value ?? '').trim() !== '')) rows.push(record);
  }
  return rows;
}
