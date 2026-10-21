import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { POST_VIDEO_MAX_BYTES, videoProblem } from './post-video.ts';
import { fitWithin, nativeCompressor, prepareProgressText, prepareVideo, VIDEO_TARGET_BPS, videoBitrateFor, webCodecsPresent, worthCompressing } from './video-prepare.ts';

const MB = 1024 * 1024;
const fakeFile = (bytes: number, name = 'ferias.mov') => new File([new Uint8Array(bytes)], name, { type: 'video/quicktime' });

describe('compressão de vídeo (regras)', () => {
  it('bitrate: 3,5 Mbps para vídeos curtos e menos para os longos, sempre cabendo no limite', () => {
    assert.equal(videoBitrateFor(30), VIDEO_TARGET_BPS);
    assert.equal(videoBitrateFor(60), VIDEO_TARGET_BPS);
    const longo = videoBitrateFor(180);
    assert.ok(longo < VIDEO_TARGET_BPS && longo > 1_500_000, `180 s deveria ficar entre 1,5 e 3,5 Mbps, deu ${longo}`);
    // Vídeo de 180 s + áudio de 128 kbps no bitrate escolhido cabe nos 60 MB.
    assert.ok(((longo + 128_000) * 180) / 8 < POST_VIDEO_MAX_BYTES);
    assert.equal(videoBitrateFor(0), VIDEO_TARGET_BPS, 'duração desconhecida usa o padrão');
    assert.equal(videoBitrateFor(Number.NaN), VIDEO_TARGET_BPS);
    assert.ok(videoBitrateFor(100_000) >= 600_000, 'nunca abaixo do mínimo');
  });

  it('tamanho: reduz para a classe 720p mantendo a proporção, em pé ou deitado, com números pares', () => {
    assert.deepEqual(fitWithin(3840, 2160), { width: 1280, height: 720 });
    assert.deepEqual(fitWithin(2160, 3840), { width: 720, height: 1280 });
    assert.deepEqual(fitWithin(1920, 1080), { width: 1280, height: 720 });
    assert.deepEqual(fitWithin(1080, 1920), { width: 720, height: 1280 });
    const odd = fitWithin(2001, 1501)!;
    assert.ok(odd.width % 2 === 0 && odd.height % 2 === 0);
    assert.equal(fitWithin(1280, 720), undefined, 'já cabe');
    assert.equal(fitWithin(640, 480), undefined, 'nunca amplia');
    assert.equal(fitWithin(0, 0), undefined);
  });

  it('vale comprimir quando passa do limite ou é grande e pesado; vídeo pequeno segue como está', () => {
    assert.equal(worthCompressing({ sizeBytes: 200 * MB, seconds: 60 }), true, 'passa de 60 MB');
    assert.equal(worthCompressing({ sizeBytes: 5 * MB, seconds: 10 }), false, 'já é pequeno');
    assert.equal(worthCompressing({ sizeBytes: 40 * MB, seconds: 60 }), true, '~5 Mbps: acima do desejado');
    assert.equal(worthCompressing({ sizeBytes: 20 * MB, seconds: 60 }), false, '~2,8 Mbps: já está bom');
    assert.equal(worthCompressing({ sizeBytes: 30 * MB, seconds: Number.NaN }), true, 'sem duração, na dúvida reduz');
  });

  it('o limite de escolha sobe só quando o aparelho consegue reduzir', () => {
    const big = { type: 'video/quicktime', size: 300 * MB };
    assert.equal(videoProblem(big), 'O vídeo passa de 60 MB. Escolha um mais curto.');
    assert.equal(videoProblem(big, { canCompress: true }), undefined);
    assert.equal(videoProblem({ type: 'video/mp4', size: 600 * MB }, { canCompress: true }), 'O vídeo passa de 500 MB. Escolha um mais curto.');
    assert.equal(videoProblem({ type: 'video/avi', size: 1 * MB }, { canCompress: true }), 'Use um vídeo MP4, WebM ou MOV.');
  });

  it('detecta o compressor nativo e as peças do navegador', () => {
    assert.equal(nativeCompressor({}), undefined);
    assert.equal(nativeCompressor({ AskouTVideo: {} as never }), undefined);
    const native = { compress: async () => undefined };
    assert.equal(nativeCompressor({ AskouTVideo: native }), native);
    assert.equal(webCodecsPresent({}), false);
    assert.equal(webCodecsPresent({ VideoEncoder: function () {}, VideoDecoder: function () {} }), true);
  });

  it('texto de progresso', () => {
    assert.equal(prepareProgressText(0), 'Otimizando o vídeo… 0%');
    assert.equal(prepareProgressText(0.426), 'Otimizando o vídeo… 42%');
    assert.equal(prepareProgressText(7), 'Otimizando o vídeo… 100%');
    assert.equal(prepareProgressText(Number.NaN), 'Otimizando o vídeo… 0%');
  });
});

describe('prepareVideo com o compressor nativo', () => {
  it('usa o arquivo do nativo quando ele fica menor, e repassa o progresso', async () => {
    const original = fakeFile(10 * MB);
    const smaller = fakeFile(3 * MB, 'ferias.mp4');
    const seen: number[] = [];
    const native = { compress: async (_f: File, o: { maxEdge: number; videoBitsPerSecond: number; onProgress?: (n: number) => void }) => { assert.deepEqual([o.maxEdge, o.videoBitsPerSecond], [1280, VIDEO_TARGET_BPS]); o.onProgress?.(0.5); return smaller; } };
    const out = await prepareVideo(original, { native, onProgress: (n) => seen.push(n) });
    assert.deepEqual([out.file === smaller, out.compressed, out.originalBytes], [true, true, 10 * MB]);
    assert.deepEqual(seen, [0.5]);
  });

  it('nativo que falha, devolve nada ou devolve um arquivo maior: segue o original (sem WebCodecs aqui)', async () => {
    const original = fakeFile(10 * MB);
    for (const compress of [async () => { throw new Error('plugin caiu'); }, async () => undefined, async () => fakeFile(12 * MB), async () => fakeFile(0)]) {
      const out = await prepareVideo(original, { native: { compress } });
      assert.deepEqual([out.file === original, out.compressed, out.reason], [true, false, 'unsupported']);
    }
  });

  it('se o original passa do limite, um arquivo do nativo é aceito mesmo sem ser menor que ele', async () => {
    const original = fakeFile(80 * MB);
    const out = await prepareVideo(original, { native: { compress: async () => fakeFile(50 * MB, 'x.mp4') } });
    assert.equal(out.compressed, true);
  });

  it('sem nativo e sem WebCodecs: original, sem lançar erro', async () => {
    const out = await prepareVideo(fakeFile(2 * MB), { native: undefined });
    assert.deepEqual([out.compressed, out.reason], [false, 'unsupported']);
  });
});
