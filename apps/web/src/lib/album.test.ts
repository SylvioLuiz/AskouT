import assert from 'node:assert/strict';
import { test } from 'node:test';
import { albumName, albumPhotosText, albumWith } from './album.ts';

test('nome do álbum: evento, lugar ou o padrão de cada tipo', () => {
  assert.equal(albumName({ kind: 'EVENT', title: 'Samba', placeName: 'Bar do Zé' }), 'Samba');
  assert.equal(albumName({ kind: 'FLASH', title: null, placeName: 'Praça' }), 'Praça');
  assert.equal(albumName({ kind: 'FLASH', title: null, placeName: null }), 'Encontro do NOW');
  assert.equal(albumName({ kind: 'EVENT', title: null, placeName: null }), 'Evento');
});

test('textos de amigos e de fotos no singular e no plural', () => {
  assert.equal(albumWith(0), 'Só você');
  assert.equal(albumWith(1), 'Com 1 amigo');
  assert.equal(albumWith(4), 'Com 4 amigos');
  assert.equal(albumPhotosText(1), '1 foto');
  assert.equal(albumPhotosText(7), '7 fotos');
});
