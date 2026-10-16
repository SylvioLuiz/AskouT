# Auditoria completa de UX/UI: AskouT (apps/web)

**Data**: 2026-10-16
**Modo**: Saúde geral do repositório (sem diff), focado no app web
**Fonte**: `apps/web/src` (15,3 mil linhas; `styles.css` com 3,9 mil)
**Lentes executadas**: 6 de 10 (Design, UX, Frontend, Repositório, Performance, Acessibilidade)
**Lentes puladas**: Backend (sem Rust/Tauri), Estrutural (sem mudança de módulos), Produção (fora do escopo UX/UI), DX (o app não é ferramenta de desenvolvedor)

> **Limite honesto desta auditoria:** foi feita lendo o código e medindo o CSS (contraste, tamanhos, regras). Ninguém abriu o app num celular. Tudo que depende de ver a tela (espaçamento real, gestos, teclado do iPhone) está marcado como "a confirmar no aparelho".

---

## Veredito geral: APROVADO COM MUDANÇAS

A base é boa: HTML semântico, rótulos em quase tudo, folhas (sheets) com foco preso e devolvido, link de pular para o conteúdo, `lang="pt-BR"`, avisos de estado (`role="status"`) e animações com redução de movimento. Os problemas se concentram em quatro frentes: **contraste de bordas e do semáforo no escuro**, **alvos de toque pequenos**, **recuperação de contexto ao navegar** (rolagem e foco) e **CSS com regras duplicadas** que já causaram bugs reais (como os chips de "Como a data é confirmada").

## Veredito por lente

| # | Lente | Veredito | Críticos | Recomendações |
|---|-------|----------|----------|---------------|
| 1 | Design | Aprovado com mudanças | 2 | 6 |
| 2 | UX | Aprovado com mudanças | 2 | 7 |
| 3 | Frontend | Aprovado com mudanças | 1 | 4 |
| 4 | Repositório | Aprovado com mudanças | 0 | 4 |
| 5 | Performance | Aprovado | 0 | 3 |
| 6 | Acessibilidade | Aprovado com mudanças | 3 | 5 |

## Problemas críticos (corrigir primeiro)

| # | Problema | Lente | Onde | Impacto | Correção |
|---|----------|-------|------|---------|----------|
| 1 | Bordas de campos e botões com contraste de 1,68:1 no claro e 2,16:1 no escuro (o mínimo para controles é 3:1) | Acessibilidade, Design | `--line-strong` em `.search__input`, `.chip`, `.optlist__item` | Quem enxerga pouco não vê onde termina um campo | Escurecer `--line-strong` (claro ≈ `#8e8e93`; escuro ≈ `#6d7189`) só para bordas de controles, mantendo `--line` para divisores |
| 2 | Cores do semáforo (`--ok`, `--warn`, `--bad`, `--wait`) iguais nos dois temas. Laranja `#ff9500` em fundo branco dá 2,2:1 e verde no escuro dá 3,3:1 | Design, Acessibilidade | `:root` e bloco escuro de `styles.css` | Disponibilidade é o diferencial do produto e é a parte mais difícil de ler | Criar versões por tema e nunca usar só a cor: ponto + ícone/texto ("Livre", "Talvez", "Ocupado") |
| 3 | Alvos de toque abaixo de 44 px: 20 a 36 px em fechar foto, apagar comentário, enviar, gravar voz, pontos do carrossel, caixas de seleção | Acessibilidade, UX | `.composepics__remove` 32, `.comment__del` 36, `.voice__btn` 36, `.pcarousel__dot` 20, `.radios__item input` 20 | Erros de toque, principalmente no celular | Manter o visual e ampliar a área clicável com `::after` (inset negativo) até 44 px |
| 4 | Ao navegar, a página sempre rola para o topo (inclusive ao voltar) e o foco não vai para o conteúdo | UX, Acessibilidade | `router.tsx:22` | Voltar da conversa para a lista perde o lugar; leitor de tela não percebe a troca de tela | Guardar a rolagem por rota ao voltar; mover o foco para o título da nova tela |
| 5 | Ações da mensagem só por pressão longa, arrasto e "⋯" que fica invisível em dispositivos com mouse até passar o cursor | UX, Acessibilidade | `.msg__more` e `swipe-reply.tsx` | Usuário de teclado e leitor de tela não descobre responder, reagir e apagar | Deixar o "⋯" sempre visível com baixo contraste e garantir que ele abra o mesmo menu da pressão longa |
| 6 | Regras duplicadas de `.chip` (linhas 1492 e 3155) | Frontend, Repositório | `styles.css` | Já quebrou o alinhamento dos botões da votação; qualquer ajuste novo pode quebrar de novo | Separar em `.chip` (filtro) e `.tagchip` (etiqueta removível) |

## Preocupações transversais (apontadas por 2 ou mais lentes)

| Preocupação | Lentes | Causa | Correção única |
|-------------|--------|-------|----------------|
| Cor fora dos tokens: 226 cores fixas no CSS, algumas sem versão para o escuro (`#c9cdea`, `#f0a30a`, sombras `rgb(58 54 245)` azuis) | Design, Repositório | Tokens novos (degradê roxo-rosa) só cobrem parte do app | Criar tokens `--accent-glow`, `--shadow-brand`, `--warn-fill` e trocar os valores fixos |
| Três paletas convivem: claro azul, escuro roxo-rosa e conversa azul | Design, UX | Decisão de produto recente | Registrar a regra em um único comentário no topo do CSS e testar as telas de fronteira (folhas dentro da conversa) |
| Feedback pobre ao carregar: só o texto "Carregando…" em 16 telas; nenhum esqueleto | UX, Performance | Componente `Loading` único | Esqueletos para lista de conversas, feed e perfil |
| Escrita e toque dependem de gesto (arrastar, pressionar) sem alternativa visível | UX, Acessibilidade | Padrão copiado de apps de mensagem | Ver crítico 5 |

---

# Relatórios por lente

## 1. Design

**Veredito**: Aprovado com mudanças

**Evidências medidas**
- 33 usos de 15 px, 32 de 13 px, 26 de 14 px, 25 de 12 px: escala tipográfica com cerca de 14 tamanhos. Há 3 usos de 11 px (`.6875rem`), abaixo do mínimo recomendado de 12 px em texto corrido.
- `z-index`: 10 valores distintos (1, 2, 15, 20, 60, 90, 95, 96, 100). Funciona, mas sem escala nomeada.
- Apenas 1 `!important`; 10 `style={{}}` inline. Disciplina boa.
- `.chip` definido duas vezes com significados diferentes.

| # | Recomendação | Por quê | Correção |
|---|-------------|---------|----------|
| D1 | Reduzir a escala de fontes para 6 degraus (12, 14, 16, 18, 22, 28) | Hierarquia mais clara e menos regras | Tokens `--fs-1..6` |
| D2 | Nomear a escala de `z-index` | Evitar a briga de empilhamento que já tivemos no popup | `--z-sticky`, `--z-bar`, `--z-sheet`, `--z-popup` |
| D3 | Degradê roxo-rosa só em ações principais | Hoje aparece em contadores, interruptores, chips e botões; perde o poder de destaque | Usar em 1 ação por tela; o resto fica no rosa sólido |
| D4 | Sombras com a cor da marca | Sombra azul antiga aparece no tema novo | Token `--shadow-brand` por tema |
| D5 | Estados desabilitado e carregando uniformes nos botões | Alguns botões de ícone não mudam ao desabilitar | Regra comum `:disabled` |
| D6 | Raio de borda: 12, 16, 20, 24 e 999 coexistem | Aparência levemente irregular | Dois raios (controle 12, painel 20) mais 999 |

**Cobertura de estados (amostra)**

| Elemento | Hover | Foco | Ativo | Desabilitado | Carregando | Vazio | Erro | Escuro |
|----------|-------|------|-------|--------------|-----------|-------|------|--------|
| Botão primário | Sim | Sim | Sim | Sim | Sim | n/a | n/a | Sim |
| Campo de texto | Parcial | Sim | n/a | Sim | n/a | n/a | Sim | Sim |
| Chip de filtro | Sim | Sim | Sim | Parcial | n/a | n/a | n/a | Sim |
| Lista de conversas | n/a | Sim | n/a | n/a | Só texto | Sim | Sim | Sim |
| Semáforo de disponibilidade | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **Não** |
| Balão de mensagem | n/a | Parcial | n/a | n/a | n/a | Sim | n/a | Sim |

## 2. UX

**Veredito**: Aprovado com mudanças

**Jornada: abrir uma conversa e responder**
1. Lista de conversas, toque na linha: OK.
2. Conversa abre com topo fixo e campo no fim: OK.
3. Responder arrastando a mensagem: OK para quem conhece o gesto, **AVISO** para quem não conhece (sem pista visual).
4. Pressão longa abre reações e ações: OK, **AVISO** sem alternativa visível em tela de mouse.
5. Voltar para a lista: **FALHA**, perde a posição de rolagem.

| # | Recomendação | Impacto | Correção |
|---|-------------|---------|----------|
| U1 | Dica de primeiro uso para arrastar e pressionar | Gestos invisíveis não são descobertos | Dica única na primeira conversa |
| U2 | Esqueletos de carregamento | "Carregando…" gera ansiedade e não mostra a forma da tela | Esqueleto por tipo de lista |
| U3 | Desfazer após apagar mensagem ou sair do grupo | Ações destrutivas hoje só têm confirmação | Aviso temporário com "Desfazer" por alguns segundos (apagar mensagem) |
| U4 | Rascunho preservado em formulários longos (evento, perfil de local) | Fechar sem querer apaga tudo | Guardar rascunho local |
| U5 | Confirmações específicas | "Sair do grupo" já explica; padronizar o mesmo nível em todas | Texto "o que acontece" em todo `Confirm` |
| U6 | Votação de data: explicar o resultado da melhor data em uma frase | Usuário não entende por que um dia venceu | Frase "Melhor dia: sábado, todos podem" |
| U7 | Busca nas conversas sem resultado | Estado vazio genérico | Mensagem com o termo e botão "Limpar busca" |

**Consistência de interação:** a conversa, a lista e o grupo usam o mesmo padrão de menu ⋯ + folha, o que é bom. Desvio: pressão longa só existe na mensagem; nos posts do feed não.

## 3. Frontend

**Veredito**: Aprovado com mudanças

- 16 telas usam `useAsync`; `usePolling` em 12 pontos com 10 a 30 s. Funciona, mas várias telas puxam a mesma lista (conversas a cada 10 s na lista e a cada 15 s no `Shell`).
- Telas grandes: `flash.tsx` (671), `conversations.tsx` (636), `venue-page.tsx` (601). Candidatas a divisão.
- Uma única regra `!important` e `role="link"` em `<span>` (`venue-link.tsx`) em vez de `<a>`.

| # | Recomendação | Correção |
|---|-------------|----------|
| F1 | Unificar o polling de conversas | Um único fornecedor de dados (contexto) usado por `Shell` e lista |
| F2 | Dividir `conversations.tsx` | Separar lista, conversa, barra de seleção e campo de mensagem |
| F3 | Trocar `span role="link"` por `<a>` | Semântica nativa de teclado e clique do meio |
| F4 | `router.tsx`: restaurar rolagem e mover foco | Ver crítico 4 |

## 4. Repositório (convenções)

**Veredito**: Aprovado com mudanças

- `styles.css` único com 3,9 mil linhas e seletores repetidos (`.profile__counts` 7 vezes, `.vrate__stars--five` 5 vezes, `.msgpop__menu` 4 vezes).
- Blocos "apêndice" ao fim do arquivo sobrescrevem blocos antigos: eficaz, mas o resultado final fica difícil de prever.

| # | Recomendação | Correção |
|---|-------------|----------|
| R1 | Dividir o CSS por área (base, componentes, telas, temas) | Arquivos importados em ordem fixa |
| R2 | Consolidar seletores repetidos | Mesclar regras; apagar as mortas |
| R3 | Teste automático que falha em cor fixa nova fora dos tokens | Script simples sobre `styles.css` |
| R4 | Teste de contraste dos tokens por tema | Reaproveitar a conta usada nesta auditoria |

## 5. Performance (lado do navegador)

**Veredito**: Aprovado

- Mapas carregados sob demanda (`lazy`), 10 imagens com `loading="lazy"`: bom.
- 7 usos de `backdrop-filter` (desfoque) em barras e popups: custo em celulares antigos.
- Conversa longa sem virtualização; a paginação "Ver mensagens anteriores" limita o custo.

| # | Recomendação | Correção |
|---|-------------|----------|
| P1 | Polling pausar com a aba oculta | `document.visibilityState` no `usePolling` |
| P2 | Reduzir desfoque em aparelhos fracos | Consulta `prefers-reduced-transparency` ou fundo sólido |
| P3 | Imagem de fundo da conversa em base64 no armazenamento local | Aceitável (até 180 KB); avisar se o armazenamento estiver cheio |

## 6. Acessibilidade

**Veredito**: Aprovado com mudanças

**Pontos fortes verificados:** `lang="pt-BR"`, link "pular para o conteúdo", `nav` com `aria-label`, `aria-current` na navegação, 302 atributos `aria-*`, 21 regiões de aviso, folha com `role="dialog"`, `aria-modal`, foco preso, Esc fecha e foco volta ao botão de origem, campos com `aria-invalid` e `aria-describedby`, 20 estilos `:focus-visible`, 7 consultas de redução de movimento, imagens com texto alternativo (exceto verificação pendente em `post.tsx:22`).

**Contraste medido**

| Par | Razão | Resultado |
|-----|-------|-----------|
| Texto secundário sobre fundo (claro) | 5,97:1 | Passa |
| Azul de marca sobre fundo (claro) | 4,99:1 | Passa |
| Rosa `#FA72C9` sobre fundo escuro | 6,7:1 | Passa |
| Texto escuro sobre o degradê `#B56EFC` | 5,59:1 | Passa |
| Azul da conversa no escuro | 6,45:1 | Passa |
| Laranja do semáforo sobre branco | 2,2:1 | **Falha** |
| Verde do semáforo sobre cartão escuro | 3,33:1 | **Falha para texto** |
| Borda de controle (claro) | 1,68:1 | **Falha (3:1)** |
| Borda de controle (escuro) | 2,16:1 | **Falha (3:1)** |

| # | Recomendação | Critério WCAG | Correção |
|---|-------------|---------------|----------|
| A1 | Bordas de controles | 1.4.11 | Ver crítico 1 |
| A2 | Semáforo só por cor | 1.4.1, 1.4.3 | Ver crítico 2 |
| A3 | Alvos de toque | 2.5.5 (AAA) / boa prática iOS | Ver crítico 3 |
| A4 | Ações da mensagem sem teclado | 2.1.1 | Ver crítico 5 |
| A5 | Texto não selecionável na conversa | Uso | `user-select: none` impede copiar texto; manter só durante a pressão longa e liberar no resto |
| A6 | Verificar `alt` da imagem em `post.tsx:22` | 1.1.1 | Texto alternativo descritivo |

**Roteiro de teclado**

| Passo | Ação | Foco esperado | Anunciado | Atende? |
|-------|------|---------------|-----------|---------|
| 1 | Tab na primeira tela | "Pular para o conteúdo" | Link | Sim |
| 2 | Abrir folha ⋯ | Painel da folha | Diálogo com o título | Sim |
| 3 | Esc | Volta ao botão que abriu | n/a | Sim |
| 4 | Tab na conversa até a mensagem | Botão "⋯" da mensagem | "Opções da mensagem" | **Parcial** (só aparece com foco no mouse) |
| 5 | Trocar de tela | Título da nova tela | Nome da tela | **Não** |
| 6 | Seleção de várias mensagens | Caixas de seleção | "Selecionar mensagem de…" | Sim |

---

## Ordem sugerida de correção

1. **Rápido e de alto efeito** (meio dia): bordas dos controles, semáforo por tema com texto, `.chip` separado, "⋯" visível.
2. **Alvos de toque** (meio dia): ampliar áreas clicáveis com `::after`.
3. **Navegação** (um dia): restaurar rolagem, mover foco, pausar polling com aba oculta.
4. **Feedback** (um a dois dias): esqueletos, desfazer, rascunhos.
5. **Organização do CSS** (dois dias): dividir, consolidar, teste de cor fora dos tokens.
