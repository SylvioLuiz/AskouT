import { useId } from 'react';
import { SearchIcon } from './icons.tsx';
import { t } from '../lib/i18n/index.ts';

/** Barra de busca das listas de pessoas (amigos, seguidores, seguindo): por nome ou @. */
export function PeopleSearch({ value, onChange, label = t('Buscar por nome ou @') }: { value: string; onChange: (value: string) => void; label?: string }) {
  const id = useId();
  return (
    <div className="search search--explore search--people" role="search">
      <span className="search__icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="search__input search__input--icon" type="search" placeholder={label} value={value} maxLength={60} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
