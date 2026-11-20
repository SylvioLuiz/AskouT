import { t } from '../lib/i18n/index.ts';

/** Etiqueta discreta "Rolando agora": bolinha que pulsa, nas cores do AskouT. */
export function LiveTag() {
  return (
    <span className="livetag">
      <span className="livetag__dot" aria-hidden="true" />
      {t('Rolando agora')}
    </span>
  );
}
