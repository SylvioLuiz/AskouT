import { useEffect, useState } from 'react';
import { Button, ErrorState, Loading, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { currentSubscription, disableNativePush, disablePush, enableNativePush, enablePush, nativePushBridge, pushState, readEnvironment, readNativeState, refreshNativeToken } from '../lib/push.ts';
import type { PushState } from '../lib/push.ts';
import type { NotificationMute, PushTestResult } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

const COPY: Record<Exclude<PushState, 'off' | 'on'>, string> = {
  unsupported: t('Este navegador não permite avisos fora do app. Os avisos continuam aparecendo aqui dentro.'),
  'needs-install': t('No iPhone e no iPad, os avisos só funcionam com o AskouT na Tela de Início: toque em Compartilhar e em "Adicionar à Tela de Início", depois abra por lá.'),
  'not-configured': t('Os avisos fora do app ainda não estão ligados neste servidor. Os avisos continuam aparecendo aqui dentro.'),
  denied: t('Você bloqueou os avisos deste site no navegador. Para receber, libere as notificações nas configurações do site e volte aqui.'),
};

const NATIVE_DENIED = t('Os avisos do AskouT estão bloqueados neste iPhone. Para receber, libere em Ajustes > AskouT > Notificações e volte aqui.');

/** Liga ou desliga os avisos fora do app neste aparelho. */
export function PushCard({ hideInstallHint = false }: { hideInstallHint?: boolean } = {}) {
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

  // Com os avisos já ligados não há o que mostrar (para desligar: Ajustes do aparelho ou do navegador).
  if (!state || state === 'on') return null;
  if (hideInstallHint && state === 'needs-install') return null;
  if (state !== 'off') return <p className="muted pushcard__hint">{state === 'denied' && nativePushBridge() ? NATIVE_DENIED : COPY[state]}</p>;
  return (
    <div className="callout pushcard">
      <p className="callout__text">
        <strong>{t('Receba avisos fora do app')}</strong>
        <br />
        {t('Mensagens, convites e encontros chegam como notificação, mesmo com o AskouT fechado.')}
      </p>
      <div className="row-actions">
        <Button small loading={busy} onClick={() => void toggle(true)}>
          {t('Ativar avisos')}
        </Button>
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


/** Texto do resultado do aviso de teste. Exportado para os testes. */
export function pushTestSummary(r: PushTestResult): { tone: 'ok' | 'error'; text: string } {
  if (r.devices === 0) return { tone: 'error', text: t('Nenhum aparelho com avisos ligados na sua conta. Ative os avisos acima e tente de novo.') };
  const parts: string[] = [];
  const label: Record<'ios' | 'android' | 'web', string> = { ios: 'iPhone', android: 'Android', web: t('navegador') };
  for (const kind of ['android', 'ios', 'web'] as const) {
    const k = r.byKind[kind];
    if (k.sent + k.failed === 0) continue;
    parts.push(k.failed === 0 ? t('{where}: enviado', { where: label[kind] }) : t('{where}: {sent} enviado(s), {failed} recusado(s)', { where: label[kind], sent: k.sent, failed: k.failed }));
  }
  const detail = parts.join(' · ');
  if (r.failed === 0) return { tone: 'ok', text: t('Aviso de teste enviado ({detail}). Se não apareceu, confira se as notificações do AskouT estão liberadas nos ajustes do aparelho.', { detail }) };
  return { tone: 'error', text: t('Alguns aparelhos recusaram o aviso de teste ({detail}). Desligue e ligue os avisos de novo neste aparelho e tente outra vez.', { detail }) };
}

/** Botão para mandar um aviso de teste aos próprios aparelhos (confere se o push está chegando). */
export function PushTestCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  async function send() {
    setBusy(true);
    setResult(undefined);
    try {
      setResult(pushTestSummary(await api.pushTest()));
    } catch (failure) {
      setResult({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="setting">
      <div className="setting__text">
        <h3 className="setting__title">{t('Testar avisos')}</h3>
        <p className="setting__help">{t('Manda um aviso para os seus aparelhos 5 segundos depois de tocar. Minimize o app nesse meio tempo para ver a notificação chegar com a prévia.')}</p>
        <div className="row-actions">
          <Button small variant="secondary" loading={busy} onClick={() => void send()}>
            {t('Enviar teste')}
          </Button>
        </div>
        {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}
      </div>
    </section>
  );
}
