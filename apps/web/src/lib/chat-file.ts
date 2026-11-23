import { t } from './i18n/index.ts';

/**
 * Documentos na conversa (PDF, Word, Excel, PowerPoint, texto). Os mesmos tipos e o mesmo teto do servidor
 * (apps/api/src/core/media.ts, CHAT_FILE_TYPES e CHAT_FILE_MAX_BYTES).
 */
export const CHAT_FILE_MAX_BYTES = 25 * 1024 * 1024;

const BY_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
};
const KNOWN = new Set(Object.values(BY_EXT));

/** Para o seletor de arquivos (`accept`). */
export const CHAT_FILE_ACCEPT = [...Object.keys(BY_EXT).map((e) => `.${e}`), ...KNOWN].join(',');

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Tipo do documento: o que o aparelho informou, se for um dos aceitos; senão, pela extensão (alguns aparelhos e
 * apps mandam "application/octet-stream" ou nada). `undefined`: não é um documento aceito.
 */
export function documentType(name: string, type: string): string | undefined {
  const base = type.split(';')[0]!.trim().toLowerCase();
  if (KNOWN.has(base)) return base;
  return BY_EXT[fileExtension(name)];
}

/** O que está errado com o arquivo, ou `undefined` se dá para enviar. */
export function fileProblem(file: { name: string; type: string; size: number }): string | undefined {
  if (!documentType(file.name, file.type)) return t('Dá para enviar PDF, documentos, planilhas, apresentações e textos.');
  if (file.size === 0) return t('Esse arquivo está vazio.');
  if (file.size > CHAT_FILE_MAX_BYTES) return t('O arquivo passa de 25 MB.');
  return undefined;
}

/** "PDF", "Word", "Excel"... para o balão do arquivo. */
export function fileLabel(name: string): string {
  const ext = fileExtension(name);
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx' || ext === 'odt' || ext === 'rtf') return t('Documento');
  if (ext === 'xls' || ext === 'xlsx' || ext === 'ods' || ext === 'csv') return t('Planilha');
  if (ext === 'ppt' || ext === 'pptx' || ext === 'odp') return t('Apresentação');
  if (ext === 'txt') return t('Texto');
  return t('Arquivo');
}

/** "1,2 MB", "340 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
