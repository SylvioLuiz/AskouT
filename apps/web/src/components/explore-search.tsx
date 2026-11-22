import type { Ref } from 'react';
import { SearchIcon } from './icons.tsx';
import { t } from '../lib/i18n/index.ts';

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter no teclado (o teclado fecha). */
  onSubmit?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Mostra o indicador de "buscando" no lugar do botão de limpar. */
  busy?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

/**
 * Campo de busca do Explorar, o mesmo na Lista e no Mapa.
 * A fonte é de 16px de propósito: abaixo disso o iOS dá zoom na página ao focar o campo e não volta.
 */
export function ExploreSearch({ id, value, onChange, onSubmit, onFocus, onBlur, busy = false, inputRef }: Props) {
  return (
    <form
      className="xsearch"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(value);
        // Fecha o teclado depois de buscar.
        (document.activeElement as HTMLElement | null)?.blur?.();
      }}
    >
      <span className="xsearch__icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <label className="visually-hidden" htmlFor={id}>
        {t('Buscar eventos, locais, pessoas ou #')}
      </label>
      <input
        id={id}
        ref={inputRef}
        className="xsearch__input"
        type="search"
        enterKeyHint="search"
        placeholder={t('Eventos, locais, pessoas ou #')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={80}
      />
      {busy ? (
        <span className="xsearch__spin" role="status" aria-label={t('Buscando')} />
      ) : value ? (
        <button
          type="button"
          className="xsearch__clear"
          aria-label={t('Limpar busca')}
          // Não tira o foco do campo: dá para limpar e já digitar de novo.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onChange('')}
        >
          ×
        </button>
      ) : null}
    </form>
  );
}
