import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { columnIndex, columnName, readCsv, readXlsx, unzip, writeXlsx, zip } from './xlsx.ts';
import { venueRowsFromSheet, venueTemplate, VENUE_COLUMNS } from './venue-import.ts';

test('colunas: A..Z, AA e de volta', () => {
  assert.deepEqual([0, 25, 26, 27, 701].map(columnName), ['A', 'Z', 'AA', 'AB', 'ZZ']);
  assert.deepEqual(['A1', 'Z9', 'AA10', 'ZZ3'].map(columnIndex), [0, 25, 26, 701]);
});

test('o modelo gerado é lido de volta: cabeçalho, exemplo e acentos', async () => {
  const bytes = writeXlsx(venueTemplate());
  const rows = await readXlsx(bytes);
  assert.deepEqual(rows[0], VENUE_COLUMNS.map((c) => c.header));
  assert.equal(rows[1]![0], 'Bar do Zé');
  const parsed = venueRowsFromSheet(rows);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual([parsed.rows[0]!.name, parsed.rows[0]!.lat, parsed.lines[0]], ['Bar do Zé', '-23.5558', 2]);
});

test('lê xlsx comprimido com textos compartilhados, números e células puladas', async () => {
  const enc = new TextEncoder();
  const shared = '<sst><si><t>Nome</t></si><si><r><t>Ende</t></r><r><t>reço</t></r></si><si><t>Bar &amp; Cia</t></si><si><t>Latitude</t></si></sst>';
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>-23.5</v></c></row></sheetData></worksheet>';
  const files = [
    { path: 'xl/workbook.xml', data: enc.encode('<workbook><sheets><sheet name="X" sheetId="1" r:id="rId7"/></sheets></workbook>') },
    { path: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId7" Target="worksheets/data.xml"/></Relationships>') },
    { path: 'xl/sharedStrings.xml', data: enc.encode(shared) },
  ];
  // Monta um zip com o sheet comprimido (deflate), como o Excel salva.
  const plain = zip([...files, { path: 'xl/worksheets/data.xml', data: enc.encode(sheet) }]);
  const entries = await unzip(plain);
  assert.equal(entries.size, 4);
  const deflated = deflateRawSync(Buffer.from(sheet));
  const compressed = zip([...files, { path: 'xl/worksheets/data.xml', data: new Uint8Array(deflated) }]);
  // Marca o último arquivo como "deflate" (método 8) no cabeçalho local e no diretório central.
  const view = new DataView(compressed.buffer);
  for (let i = 0; i < compressed.length - 4; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50 && new TextDecoder().decode(compressed.subarray(i + 30, i + 30 + view.getUint16(i + 26, true))) === 'xl/worksheets/data.xml') view.setUint16(i + 8, 8, true);
    if (sig === 0x02014b50 && new TextDecoder().decode(compressed.subarray(i + 46, i + 46 + view.getUint16(i + 28, true))) === 'xl/worksheets/data.xml') view.setUint16(i + 10, 8, true);
  }
  const rows = await readXlsx(compressed);
  assert.deepEqual(rows, [['Nome', 'Endereço', 'Latitude'], [], ['Bar & Cia', '', '-23.5']]);
  const parsed = venueRowsFromSheet(rows);
  assert.deepEqual(parsed.rows, [{ name: 'Bar & Cia', lat: '-23.5' }]);
  assert.deepEqual(parsed.lines, [3]);
});

test('csv com ponto e vírgula, aspas e cabeçalho com outros nomes', () => {
  const rows = readCsv('﻿Nome do local;Endereco;Categoria;Lon;Coluna extra\r\n"Bar; do Zé";"Rua A, 1";bar;-46,6;x\r\n;;;;\r\n');
  const parsed = venueRowsFromSheet(rows);
  assert.deepEqual(parsed.rows, [{ name: 'Bar; do Zé', address: 'Rua A, 1', category: 'bar', lng: '-46,6' }]);
  assert.deepEqual(parsed.unknownColumns, ['Coluna extra']);
  assert.ok(venueRowsFromSheet([['a', 'b']]).error);
});
