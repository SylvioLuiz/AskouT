import { useEffect, useState } from 'react';
import { Button, ErrorState, Loading, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { currentSubscription, disableNativePush, disablePush, enableNativePush, enablePush, nativePushBridge, pushState, readEnvironment, readNativeState, refreshNativeToken } from '../lib/push.ts';
import type { PushState } from '../lib/push.ts';
import type { NotificationMute } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

const COPY: Record<Exclude<PushState, 'off' | 'on'>, string> = {
  unsupported: t('Este navegador não permite avisos fora do app. Os avisos continuam aparecendo aqui dentro.'),
  'needs-install': t('No iPhone e no iPad, os avisos só funcionam com o AskouT na Tela de Início: toque em Compartilhar e em "Adicionar à Tela de Início", depois abra por lá.'),
  'not-configured': t('Os avisos fora do app ainda não estão ligados neste servidor. Os avisos continuam aparecendo aqui dentro.'),
  denied: t('Você bloqueou os avisos deste site no navegador. Para receber, libere as notificações nas configurações do site e volte aqui.'),
};

const NATIVE_DENIED = t('Os avisos do AskouT estão bloqueados neste iPhone. Para receber, libere em Ajustes > AskouT > Notificações e volte aqui.');

/** Liga ou desliga os avisos fora do app neste aparelho. */
export function PushCard() {
  const [state, setState] = useState<PushState | undefined>();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function refresh() {
    let key: string | null | undefined;
    let serverNative = false;
    try {
      const res = await api.pushKey();
      key = res.publicKey;
      serverNative = res.native === true;
    } catch {
      key = undefined;
    }
    const bridge = nativePushBridge();
    if (bridge) {
      // No app do iPhone os avisos vão pela Apple; o navegador interno não tem Web Push.
      if (serverNative) await refreshNativeToken(api, bridge).catch(() => undefined);
      setState(await readNativeState(bridge, serverNative));
      return;
    }
    const subscribed = (await currentSubscription()) !== null;
    setPublicKey(key ?? null);
    setState(pushState(readEnvironment(key, subscribed)));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggle(turnOn: boolean) {
    setBusy(true);
    setProblem(undefined);
    try {
      const bridge = nativePushBridge();
      if (bridge) {
        if (turnOn) await enableNativePush(api, bridge);
        else await disableNativePush(api);
      } else if (turnOn) {
        if (!publicKey) throw new Error(t('Os avisos fora do app não estão ligados neste servidor.'));
        await enablePush(api, publicKey);
      } else {
        await disablePush(api);
      }
      await refresh();
    } catch (failure) {
      setProblem(failure instanceof Error && !('code' in failure) ? failure.message : toApiError(failure).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  if (state !== 'off' && state !== 'on') return <p className="muted pushcard__hint">{state === 'denied' && nativePushBridge() ? NATIVE_DENIED : COPY[state]}</p>;
  return (
    <div className="callout pushcard">
      <p className="callout__text">
        <strong>{state === 'on' ? t('Avisos ligados neste aparelho') : t('Receba avisos fora do app')}</strong>
        <br />
        {state === 'on' ? t('Você é avisado de mensagens, convites e encontros mesmo com o AskouT fechado. O texto das mensagens não aparece no aviso.') : t('Mensagens, convites e encontros chegam como notificação, mesmo com o AskouT fechado.')}
      </p>
      <div className="row-actions">
        {state === 'on' ? (
          <Button small variant="secondary" loading={busy} onClick={() => void toggle(false)}>
            {t('Desligar neste aparelho')}
          </Button>
        ) : (
          <Button small loading={busy} onClick={() => void toggle(true)}>
            {t('Ativar avisos')}
          </Button>
        )}
      </div>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
    </div>
  );
}

const MUTE_ROWS: { key: 'all' | 'chats' | 'events'; title: string; help: string }[] = [
  { key: 'all', title: t('Todas'), help: t('Nenhum aviso toca no aparelho. Eles continuam aparecendo no sino.') },
  { key: 'chats', title: t('Conversas'), help: t('Sem push de mensagens e avisos de grupos. Continuam no sino.') },
  { key: 'events', title: t('Eventos'), help: t('Sem push de convites, mudanças e do lembrete de 30 min antes do evento. Continuam no sino.') },
];

/** Chaves para silenciar avisos: tudo, só conversas ou só eventos. */
export function MuteCard() {
  const current = useAsync(() => api.notificationMute(), []);
  const [override, setOverride] = useState<NotificationMute | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const value = override ?? current.data;

  async function toggle(key: 'all' | 'chats' | 'events') {
    if (!value || busy) return;
    const next = { ...value, [key]: !value[key] };
    setOverride(next);
    setProblem(undefined);
    setBusy(true);
    try {
      setOverride(await api.setNotificationMute({ [key]: next[key] }));
    } catch (failure) {
      setOverride(value);
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  if (current.error) return <ErrorState message={current.error.message} onRetry={current.reload} />;
  if (!value) return <Loading />;
  return (
    <>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {MUTE_ROWS.map((row) => {
        const forced = row.key !== 'all' && value.all;
        return (
          <section className="setting" key={row.key}>
            <div className="setting__text">
              <h3 className="setting__title" id={`mute-${row.key}`}>
                {row.title}
              </h3>
              <p className="setting__help">{row.help}</p>
            </div>
            <button type="button" role="switch" aria-checked={value[row.key] || forced} aria-labelledby={`mute-${row.key}`} className="switch" onClick={() => void toggle(row.key)} disabled={busy || forced}>
              <span className="switch__thumb" />
            </button>
          </section>
        );
      })}
    </>
  );
}

