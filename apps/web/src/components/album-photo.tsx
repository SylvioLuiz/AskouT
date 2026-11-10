import { useEffect, useState } from 'react';
import { api } from '../client.ts';

// Fotos do álbum são privadas (a rota exige o token): baixa uma vez e guarda o endereço local.
const cache = new Map<string, string>();
const CACHE_MAX = 80;

function remember(key: string, url: string) {
  cache.set(key, url);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      URL.revokeObjectURL(cache.get(oldest) as string);
      cache.delete(oldest);
    }
  }
}

export function useAlbumPhoto(albumId: string, photoId: string | null): { url: string | undefined; failed: boolean } {
  const key = `${albumId}/${photoId ?? ''}`;
  const [url, setUrl] = useState<string | undefined>(() => cache.get(key));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (photoId === null) return;
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let alive = true;
    setUrl(undefined);
    setFailed(false);
    api
      .albumPhoto(albumId, photoId)
      .then((blob) => {
        const made = URL.createObjectURL(blob);
        remember(key, made);
        if (alive) setUrl(made);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [albumId, photoId, key]);
  return { url, failed };
}
