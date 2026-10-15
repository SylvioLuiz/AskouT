import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button, Field, Notice } from './ui.tsx';
import { safeImage } from '../lib/explore.ts';
import { resizeEventCover, resizeVenueLogo } from '../lib/image.ts';

/** Imagem de capa (evento ou estabelecimento): botão "Adicionar imagem" com as duas origens (aparelho ou link da web). */
export function CoverPicker({ imageUrl, imageData, onChange, hint = 'Sem imagem, a capa usa a foto do lugar.', logo = false }: { imageUrl: string; imageData: string; onChange: (patch: { imageUrl?: string; imageData?: string }) => void; hint?: string; logo?: boolean }) {
  const [menu, setMenu] = useState(false);
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
      setMenu(false);
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
    setMenu(false);
    setLink('');
  }

  return (
    <div className="cover">
      {current ? <img className={logo ? 'cover__preview cover__preview--logo' : 'cover__preview'} src={current} alt={logo ? 'Logo' : 'Capa'} /> : null}
      <Button variant="secondary" full loading={reading} aria-expanded={menu} onClick={() => { setMenu(!menu); setLinking(false); setError(undefined); }}>
        {has ? (logo ? 'Trocar logo' : 'Trocar imagem') : logo ? 'Adicionar logo' : 'Adicionar imagem'}
      </Button>
      {menu ? (
        <div className="cover__menu" role="group" aria-label="Origem da imagem">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Fotos do aparelho
          </Button>
          <Button variant="secondary" onClick={() => { setLinking(true); setError(undefined); }}>
            Link da web
          </Button>
          {has ? (
            <Button variant="quiet" onClick={() => { onChange({ imageUrl: '', imageData: '' }); setMenu(false); }}>
              {logo ? 'Remover logo' : 'Remover imagem'}
            </Button>
          ) : null}
        </div>
      ) : null}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} aria-label="Escolher foto do aparelho" />
      {linking ? (
        <div className="cover__link">
          <Field label="Endereço da imagem" value={link} onChange={setLink} type="url" placeholder="https://" autoFocus />
          <Button small onClick={useLink}>
            Usar este link
          </Button>
        </div>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!has ? <p className="cover__hint">{hint}</p> : null}
    </div>
  );
}
