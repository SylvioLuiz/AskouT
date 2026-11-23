import { inAppPath, splitLinks } from '../lib/linkify.ts';
import { navigate } from '../router.tsx';

/**
 * Texto com os links clicáveis (mensagens do chat). Link do AskouT abre dentro do app; os outros abrem numa aba nova
 * (no app do celular, no navegador do aparelho). O toque no link não conta como toque no balão (curtir, menu).
 */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a
            key={i}
            className="textlink"
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => {
              e.stopPropagation();
              const path = inAppPath(part.href!);
              if (path) {
                e.preventDefault();
                navigate(path);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
