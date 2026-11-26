import { appHosts, inAppPath, splitLinks } from '../lib/linkify.ts';
import { splitMentions } from '../lib/mentions.ts';
import { navigate } from '../router.tsx';

/**
 * Texto com os links clicáveis (mensagens do chat). Link do AskouT abre dentro do app; os outros abrem numa aba nova
 * (no app do celular, no navegador do aparelho). O toque no link não conta como toque no balão (curtir, menu).
 */
/**
 * `mentions`: nomes de usuário que podem virar @menção destacada (no grupo, quem está na conversa). Tocar abre o perfil.
 */
export function LinkedText({ text, mentions }: { text: string; mentions?: readonly string[] }) {
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
              const path = inAppPath(part.href!, appHosts());
              if (path) {
                e.preventDefault();
                navigate(path);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {part.text}
          </a>
        ) : mentions && mentions.length > 0 ? (
          <MentionText key={i} text={part.text} mentions={mentions} />
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function MentionText({ text, mentions }: { text: string; mentions: readonly string[] }) {
  return (
    <span>
      {splitMentions(text, mentions).map((part, i) =>
        part.mention ? (
          <a
            key={i}
            className="bubble__mention"
            href={`/u/${encodeURIComponent(part.mention)}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/u/${encodeURIComponent(part.mention!)}`);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
