// Helpers utilitários para formatação e parsing de dados

import { format, isValid, parseISO } from 'date-fns';

/**
 * Converte string ou Date para Date
 * @param value String (ISO format) ou Date
 * @returns Date ou null se inválido
 */
export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }

  if (typeof value === 'string') {
    try {
      // Tenta parseISO primeiro (ISO 8601)
      const date = parseISO(value);
      if (isValid(date)) return date;

      // Tenta outros formatos comuns
      const date2 = new Date(value);
      return isValid(date2) ? date2 : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Formata quantidade com unidade opcional
 * @param value Quantidade numérica
 * @param unit Unidade (ex: 'pcs', 'kg', 'm')
 * @param decimals Número de casas decimais (default: 0)
 * @returns String formatada (ex: "1,234 pcs")
 */
export function formatQuantity(
  value: number | null | undefined,
  unit?: string,
  decimals: number = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return unit ? `- ${unit}` : '-';
  }

  const formatted = new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Formata data com formato opcional
 * @param date Date, string ISO, ou null/undefined
 * @param formatStr Formato (default: 'dd/MM/yyyy')
 * @returns String formatada ou '-' se inválido
 */
export function formatDate(
  date: Date | string | null | undefined,
  formatStr: string = 'dd/MM/yyyy',
): string {
  const parsed = parseDate(date);
  if (!parsed) return '-';

  try {
    return format(parsed, formatStr);
  } catch {
    return '-';
  }
}

/**
 * Formata data e hora
 * @param date Date, string ISO, ou null/undefined
 * @returns String formatada (ex: "04/02/2026 15:30")
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  return formatDate(date, 'dd/MM/yyyy HH:mm');
}

/**
 * Formata data e hora completa
 * @param date Date, string ISO, ou null/undefined
 * @returns String formatada (ex: "04/02/2026 15:30:45")
 */
export function formatDateTimeFull(date: Date | string | null | undefined): string {
  return formatDate(date, 'dd/MM/yyyy HH:mm:ss');
}

/**
 * Formata percentagem
 * @param value Valor entre 0 e 1 (ou 0-100 se isPercentage=true)
 * @param isPercentage Se true, assume que value já está em percentagem (0-100)
 * @param decimals Número de casas decimais (default: 1)
 * @returns String formatada (ex: "94.5%")
 */
export function formatPercentage(
  value: number | null | undefined,
  isPercentage: boolean = false,
  decimals: number = 1,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }

  const percentage = isPercentage ? value : value * 100;
  const formatted = new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(percentage);

  return `${formatted}%`;
}

/**
 * Formata duração em segundos para formato legível
 * @param seconds Duração em segundos
 * @returns String formatada (ex: "1h 30m", "45s")
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) {
    return '-';
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 && hours === 0) parts.push(`${secs}s`);

  return parts.join(' ') || '0s';
}

/**
 * Formata hash SHA-256 (mostra primeiros e últimos caracteres)
 * @param hash Hash SHA-256 completo
 * @param prefixLength Número de caracteres no início (default: 8)
 * @param suffixLength Número de caracteres no fim (default: 8)
 * @returns String formatada (ex: "6378a255...bba5cb")
 */
export function formatHash(
  hash: string | null | undefined,
  prefixLength: number = 8,
  suffixLength: number = 8,
): string {
  if (!hash || hash.length < prefixLength + suffixLength) {
    return hash || '-';
  }

  return `${hash.substring(0, prefixLength)}...${hash.substring(hash.length - suffixLength)}`;
}

/**
 * Formata moeda (EUR)
 * @param value Valor em euros
 * @param decimals Número de casas decimais (default: 2)
 * @returns String formatada (ex: "1.234,56 €")
 */
export function formatCurrency(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '- €';
  }

  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Trunca string com ellipsis
 * @param str String a truncar
 * @param maxLength Comprimento máximo
 * @returns String truncada (ex: "Texto muito l...")
 */
export function truncate(str: string | null | undefined, maxLength: number = 50): string {
  if (!str) return '-';
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength - 3)}...`;
}

/**
 * Valida se string é UUID
 * @param value String a validar
 * @returns true se é UUID válido
 */
export function isUUID(value: string | null | undefined): boolean {
  if (!value) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Valida se string é SHA-256 hash
 * @param value String a validar
 * @returns true se é SHA-256 válido
 */
export function isSHA256(value: string | null | undefined): boolean {
  if (!value) return false;
  const sha256Regex = /^[a-f0-9]{64}$/;
  return sha256Regex.test(value);
}
