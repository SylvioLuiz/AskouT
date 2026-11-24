import type { Sheet } from './xlsx.ts';

/** Uma linha de local como vai para a API (texto como veio da planilha; a API confere tudo). */
export interface VenueImportRow {
  name?: string;
  address?: string;
  category?: string;
  description?: string;
  instagram?: string;
  lat?: string;
  lng?: string;
  imageUrl?: string;
  logoUrl?: string;
  isSample?: string;
}

type Key = keyof VenueImportRow;

/** Colunas do modelo, na ordem, com os outros nomes aceitos no cabeçalho. */
export const VENUE_COLUMNS: { key: Key; header: string; aliases: string[]; help: string; example: string; width: number }[] = [
  { key: 'name', header: 'Nome', aliases: ['nome do local', 'local', 'estabelecimento'], help: 'Obrigatório. De 2 a 80 caracteres.', example: 'Bar do Zé', width: 28 },
  { key: 'address', header: 'Endereço', aliases: ['endereco completo', 'logradouro'], help: 'Rua, número, bairro e cidade. Obrigatório se não tiver latitude e longitude: a posição no mapa sai dele.', example: 'Rua Augusta, 1500 - Consolação, São Paulo - SP', width: 46 },
  { key: 'category', header: 'Tipo', aliases: ['categoria'], help: 'Opcional. Ex.: bar, balada, casa de shows, restaurante.', example: 'bar', width: 16 },
  { key: 'description', header: 'Descrição', aliases: ['sobre'], help: 'Opcional. Até 600 caracteres.', example: 'Samba ao vivo toda sexta.', width: 36 },
  { key: 'instagram', header: 'Instagram', aliases: ['insta', '@'], help: 'Opcional. @perfil ou link do perfil.', example: '@bardoze', width: 18 },
  { key: 'lat', header: 'Latitude', aliases: ['lat'], help: 'Opcional. Ex.: -23.5558. Vazia, a posição é buscada pelo endereço.', example: '-23.5558', width: 12 },
  { key: 'lng', header: 'Longitude', aliases: ['lng', 'lon', 'long'], help: 'Opcional. Ex.: -46.6623. Informe junto com a latitude.', example: '-46.6623', width: 12 },
  { key: 'imageUrl', header: 'Capa (link)', aliases: ['capa', 'imagem', 'foto', 'capa url', 'url da capa'], help: 'Opcional. Endereço https de uma imagem.', example: '', width: 24 },
  { key: 'logoUrl', header: 'Logo (link)', aliases: ['logo', 'logo url', 'url do logo'], help: 'Opcional. Endereço https de uma imagem quadrada.', example: '', width: 24 },
  { key: 'isSample', header: 'Teste', aliases: ['dado de teste', 'e teste', 'teste sim nao'], help: 'Opcional. "sim" marca como dado de teste (nunca aparece como real). Vazio = não.', example: 'não', width: 10 },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9@]+/g, ' ').trim();

const HEADER_TO_KEY = new Map<string, Key>();
for (const c of VENUE_COLUMNS) for (const h of [c.header, c.key, ...c.aliases]) HEADER_TO_KEY.set(norm(h), c.key);

/** Modelo para baixar: aba "Locais" com o cabeçalho e um exemplo, e aba "Instruções" com o que vai em cada coluna. */
export function venueTemplate(): Sheet[] {
  return [
    {
      name: 'Locais',
      rows: [VENUE_COLUMNS.map((c) => c.header), VENUE_COLUMNS.map((c) => c.example || null)],
      widths: VENUE_COLUMNS.map((c) => c.width),
    },
    {
      name: 'Instruções',
      rows: [
        ['Coluna', 'O que preencher'],
        ...VENUE_COLUMNS.map((c) => [c.header, c.help]),
        [null, null],
        ['Dicas', 'Uma linha por local, a partir da linha 2 da aba "Locais". Apague a linha de exemplo antes de importar.'],
        [null, 'Locais com o mesmo nome a menos de 250 m de um que já existe (ou de outra linha) são pulados como duplicados.'],
        [null, 'Antes de importar, a gestão mostra a prévia com o problema de cada linha. Só as linhas sem problema entram.'],
        [null, 'Também dá para anexar o mesmo conteúdo salvo como .csv.'],
      ],
      widths: [16, 110],
    },
  ];
}

/**
 * Linhas da planilha em locais: acha o cabeçalho (primeira linha com "Nome"), casa as colunas pelo nome e pula as
 * linhas vazias. `line` é o número da linha na planilha, para a prévia apontar o lugar certo.
 */
export function venueRowsFromSheet(sheet: string[][]): { rows: VenueImportRow[]; lines: number[]; unknownColumns: string[]; error?: string } {
  const headerAt = sheet.findIndex((r) => r.some((c) => HEADER_TO_KEY.get(norm(c)) === 'name'));
  if (headerAt < 0) return { rows: [], lines: [], unknownColumns: [], error: 'Não achamos o cabeçalho com a coluna "Nome". Use o modelo.' };
  const header = sheet[headerAt]!;
  const keys = header.map((h) => HEADER_TO_KEY.get(norm(h)));
  const unknownColumns = header.filter((h, i) => h.trim() !== '' && !keys[i]);
  const rows: VenueImportRow[] = [];
  const lines: number[] = [];
  for (let i = headerAt + 1; i < sheet.length; i++) {
    const cells = sheet[i] ?? [];
    if (cells.every((c) => (c ?? '').trim() === '')) continue;
    const row: VenueImportRow = {};
    keys.forEach((k, ci) => {
      const v = (cells[ci] ?? '').trim();
      if (k && v !== '') row[k] = v;
    });
    rows.push(row);
    lines.push(i + 1);
  }
  return { rows, lines, unknownColumns };
}
