import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { Button, Confirm, EmptyState, ErrorState, Loading, Notice, PageHead, PageHeadSkeleton } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { checkinLink, codeFromSearch, qrFileName } from '../lib/checkin.ts';
import { toApiError } from '../lib/errors.ts';
import { qrMatrix, qrSvg } from '../lib/qr.ts';
import { shareOrigin } from '../lib/public-origin.ts';
import { t } from '../lib/i18n/index.ts';
import { Link } from '../router.tsx';

/** PNG do QR para baixar (a folha de impressão usa o mesmo desenho). */
function downloadPng(svg: string, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error(t('Não foi possível gerar a imagem.')));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, size, size);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error(t('Não foi possível gerar a imagem.')));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      }, 'image/png');
    };
    image.onerror = () => reject(new Error(t('Não foi possível gerar a imagem.')));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Para quem administra o local: o QR da mesa ou do balcão, para baixar ou imprimir, e a troca do código. */
export function CheckinQrSheet({ venueId, venueName, onClose }: { venueId: string; venueName: string; onClose: () => void }) {
  const code = useAsync(() => api.venueCheckinCode(venueId), [venueId]);
  const [rotated, setRotated] = useState<string | undefined>();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const current = rotated ?? code.data?.code;
  const link = current ? checkinLink(shareOrigin(), venueId, current) : undefined;
  const svg = useMemo(() => (link ? qrSvg(qrMatrix(link)) : undefined), [link]);

  async function rotate() {
    setBusy(true);
    setMessage(undefined);
    try {
      setRotated((await api.rotateVenueCheckinCode(venueId)).code);
      setAsking(false);
      setMessage({ tone: 'ok', text: t('Código trocado. O QR antigo não vale mais: imprima o novo.') });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!svg) return;
    setMessage(undefined);
    try {
      await downloadPng(svg, qrFileName(venueName));
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    }
  }

  function print() {
    const done = () => {
      document.body.classList.remove('is-printing-qr');
      window.removeEventListener('afterprint', done);
    };
    document.body.classList.add('is-printing-qr');
    window.addEventListener('afterprint', done);
    window.print();
  }

  return (
    <Sheet title={t('QR code do local')} onClose={onClose}>
      <p className="muted">{t('Cole na mesa ou no balcão. Quem ler com o AskouT marca que esteve aí, e isso conta mais que confirmar presença no ranking e em "amigos que já foram".')}</p>
      {code.loading && !current ? <Loading shape="block" /> : null}
      {code.error && !current ? <ErrorState message={code.error.message} onRetry={code.reload} /> : null}
      {svg ? (
        <div className="qrcard">
          <img className="qrcard__img" alt={t('QR code de check-in de {name}', { name: venueName })} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
          <strong className="qrcard__name">{venueName}</strong>
          <span className="qrcard__hint">{t('Estive aqui · leia com o AskouT')}</span>
        </div>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {svg ? (
        <div className="vhead__actions">
          <Button onClick={() => void download()}>{t('Baixar imagem')}</Button>
          <Button variant="secondary" onClick={print}>
            {t('Imprimir')}
          </Button>
        </div>
      ) : null}
      {svg ? (
        asking ? (
          <Confirm question={t('Trocar o código? O QR que já está impresso para de funcionar.')} confirmLabel={t('Trocar código')} danger busy={busy} onConfirm={() => void rotate()} onCancel={() => setAsking(false)} />
        ) : (
          <Button variant="quiet" onClick={() => setAsking(true)}>
            {t('Trocar o código')}
          </Button>
        )
      ) : null}
    </Sheet>
  );
}

/** Destino do QR: com a conta logada, um toque marca "estive aqui". */
export function CheckinScreen({ venueId }: { venueId: string }) {
  useTitle(t('Estive aqui'));
  const code = codeFromSearch(typeof window === 'undefined' ? '' : window.location.search);
  const venue = useAsync(() => api.venueProfile(venueId), [venueId]);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => setError(undefined), [venueId]);

  async function confirm() {
    if (!code) return;
    setState('busy');
    setError(undefined);
    try {
      await api.venueCheckin(venueId, code);
      setState('done');
    } catch (failure) {
      setError(toApiError(failure).message);
      setState('idle');
    }
  }

  if (venue.loading && !venue.data) return (<><PageHeadSkeleton title={t('Estive aqui')} back={`/bares/${encodeURIComponent(venueId)}`} /><Loading shape="lines" rows={2} /></>);
  if (venue.error || !venue.data) return <ErrorState message={venue.error?.message ?? t('Não foi possível abrir esta página.')} onRetry={venue.reload} />;
  const name = venue.data.name;
  const page = `/bares/${encodeURIComponent(venueId)}`;

  return (
    <>
      <PageHead title={t('Estive aqui')} back={page} />
      {!code ? (
        <EmptyState title={t('QR code incompleto')} action={<Link to={page} className="btn btn--primary">{t('Ver a página do local')}</Link>}>
          {t('Esse link não tem o código do local. Leia o QR da mesa ou do balcão de novo.')}
        </EmptyState>
      ) : state === 'done' ? (
        <EmptyState title={t('Check-in feito!')} action={<Link to={page} className="btn btn--primary">{t('Ver a página do local')}</Link>}>
          {t('Você marcou que esteve em {name}. Isso conta no ranking do local.', { name })}
        </EmptyState>
      ) : (
        <EmptyState title={name} action={<Button loading={state === 'busy'} onClick={() => void confirm()}>{t('Estive aqui')}</Button>}>
          {t('Confirme que você está em {name}. Dá para fazer um check-in por local a cada poucas horas.', { name })}
        </EmptyState>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </>
  );
}
