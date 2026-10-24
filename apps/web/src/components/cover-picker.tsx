import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button, Notice } from './ui.tsx';
import { safeImage } from '../lib/explore.ts';
import { resizeEventCover, resizeVenueLogo } from '../lib/image.ts';

/** Imagem de capa (evento ou estabelecimento): um quadro que mostra a imagem e, dentro dele, os botões das duas origens (aparelho ou link da web). */
export function CoverPicker({ imageUrl, imageData, onChange, hint = 'Sem imagem, a capa usa a foto do rolê.', logo = false, linkOnly = false }: { imageUrl: string; imageData: string; onChange: (patch: { imageUrl?: string; imageData?: string }) => void; hint?: string; logo?: boolean; linkOnly?: boolean }) {
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = imageData !== '' ? imageData : safeImage(imageUrl.trim() === '' ? null : imageUrl.trim());
  const has = imageData !== '' || imageUrl.trim() !== '';

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    setError(undefined);
    try {
      onChange({ imageData: await (logo ? resizeVenueLogo(file) : resizeEventCover(file)), imageUrl: '' });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível usar essa imagem.');
    } finally {
      setReading(false);
    }
  }

  function useLink() {
    const v = link.trim();
    if (!/^https:\/\/\S+$/.test(v) || v.length > 500) {
      setError('Cole um endereço de imagem que comece com https://');
      return;
    }
    setError(undefined);
    onChange({ imageUrl: v, imageData: '' });
    setLinking(false);
    setLink('');
  }

  return (
    <div className="cover">
      <div className={`cover__frame${logo ? ' cover__frame--logo' : ''}${current ? ' cover__frame--has' : ''}`}>
        {current ? <img className="cover__img" src={current} alt={logo ? 'Logo' : 'Capa'} /> : <p className="cover__empty">{hint}</p>}
        {linking ? (
          <div className="cover__link">
            <input className="cover__input" type="url" inputMode="url" value={link} placeholder="https://" aria-label="Endereço da imagem" autoFocus maxLength={500} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); useLink(); } }} />
            <div className="cover__row">
              <Button small onClick={useLink}>
                Usar este link
              </Button>
              <Button small variant="quiet" onClick={() => { setLinking(false); setError(undefined); }}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="cover__actions" role="group" aria-label="Origem da imagem">
            {linkOnly ? null : (
              <Button small variant="secondary" loading={reading} onClick={() => fileRef.current?.click()}>
                Fotos do aparelho
              </Button>
            )}
            <Button small variant="secondary" onClick={() => { setLinking(true); setError(undefined); }}>
              Link da web
            </Button>
            {has ? (
              <Button small variant="secondary" onClick={() => { onChange({ imageUrl: '', imageData: '' }); setError(undefined); }}>
                Remover
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} aria-label="Escolher foto do aparelho" />
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
