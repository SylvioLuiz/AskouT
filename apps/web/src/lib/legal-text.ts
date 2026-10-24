// Textos legais do AskouT. RASCUNHO preliminar: precisa de revisão de advogado antes do lançamento (ver GOLIVE.md).
// Escrito a partir do que o aplicativo realmente faz hoje; se o produto mudar, o texto muda junto.

/** Enquanto for falso, as páginas mostram o aviso de versão preliminar. Só vire para verdadeiro depois da revisão jurídica. */
export const LEGAL_REVIEWED = false;
/** Data da versão do texto (mudar a cada alteração). */
export const LEGAL_UPDATED = '22 de outubro de 2026';

export interface LegalBlock {
  title: string;
  /** Parágrafos. */
  text?: string[];
  /** Lista de itens. */
  items?: string[];
}

export interface LegalDoc {
  title: string;
  intro: string;
  blocks: LegalBlock[];
}

/** Quem opera o AskouT. Dados do contrato social (JUCESP, NIRE 35238445720); o endereço é o informado pelo sócio em 22/10/2026. */
export const COMPANY = {
  name: 'Thunderbolt LTDA',
  cnpj: '44.953.028/0001-19',
  address: 'Av. Jabaquara, 1909, sala 62, São Paulo/SP',
  dpo: 'Sylvio Luiz de Souza',
};

export function privacyEmail(configured: string | undefined): string {
  const v = configured?.trim();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : 'privacidade@askout.com.br';
}

export function buildPrivacy(email: string): LegalDoc {
  return {
    title: 'Política de Privacidade',
    intro:
      'O AskouT ajuda amigos a combinar encontros presenciais. Esta política explica quais dados pessoais tratamos, para quê, com quem compartilhamos e como você exerce os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, a LGPD).',
    blocks: [
      {
        title: '1. Quem é o responsável',
        text: [
          `O responsável pelo tratamento (controlador) é a ${COMPANY.name}, CNPJ ${COMPANY.cnpj}, com sede na ${COMPANY.address}, empresa que opera o AskouT.`,
          `Para qualquer assunto de privacidade, inclusive falar com o encarregado de dados (DPO), ${COMPANY.dpo}, escreva para ${email}.`,
        ],
      },
      {
        title: '2. Quais dados tratamos',
        items: [
          'Conta: e-mail, @usuário, nome, e senha (guardada de forma irreversível, nunca em texto aberto). Se você entrar com Google ou Apple, recebemos a confirmação de identidade deles e o e-mail da conta.',
          'Data de nascimento: pedida no cadastro, para conferir a idade mínima (18 anos). Não aparece para outras pessoas. Você pode corrigi-la em Editar perfil (quem consta como menor de 18 anos fala com o suporte). Também guardamos o dia e a versão dos Termos que você aceitou ao criar a conta.',
          'Perfil e conteúdo: foto de perfil, posts, fotos, vídeos, eventos que você posta, comentários, curtidas e mensagens das conversas e grupos.',
          'Relações: quem você segue, quem segue você, quem você bloqueou e as pessoas que você aprova no perfil privado. Dois perfis que se seguem mutuamente são "amigos" no AskouT.',
          'Agenda e planos: os dias e horários em que você marca que pode sair, os modos "Flash" (disponibilidade temporária), enquetes de data e presença em eventos.',
          'Localização: só quando você permite. No Explorar e no mapa, usamos a posição do aparelho para achar locais e eventos perto e não guardamos essa posição. Em "Minha região" (opcional), guardamos uma coordenada arredondada (cerca de 1 km) para anúncios por região. Você pode apagá-la a qualquer momento.',
          'Uso para recomendações: quanto tempo você fica em cada conteúdo e se abriu links, para montar o bloco "Para você". Isso pode ser desligado, e ao desligar apagamos o histórico medido.',
          'Avisos: se você ativar notificações, guardamos o endereço técnico de envio do seu navegador ou aparelho.',
          'Pagamentos (donos de locais que impulsionam): o histórico do pedido e o status do pagamento. Os dados do cartão ficam só com o processador de pagamento, nunca conosco.',
          'Dados técnicos: o endereço IP, usado para segurança e para limitar tentativas abusivas. Esse controle é mantido apenas na memória do servidor, por pouco tempo.',
        ],
      },
      {
        title: '3. Para que usamos e em que base legal',
        items: [
          'Criar e manter sua conta, mostrar seu perfil e permitir conversas, planos e eventos: execução do contrato (Termos de Uso).',
          'Mostrar locais e eventos perto de você e usar sua região para anúncios por região: consentimento, dado quando você permite a localização ou toca em "Usar minha localização atual". Você pode revogar quando quiser.',
          'Recomendações com base no seu uso: legítimo interesse e, quando exigido, consentimento. Há chave para desligar em Privacidade.',
          'Segurança, prevenção a fraude e abuso, e limitar tentativas de acesso indevido: legítimo interesse e proteção do crédito e da segurança.',
          'Enviar códigos e avisos por e-mail necessários ao serviço: execução do contrato.',
          'Cumprir obrigações legais e responder a ordens de autoridades: obrigação legal.',
        ],
      },
      {
        title: '4. Quem vê o quê',
        text: [
          'Seu perfil, posts e eventos aparecem para as pessoas conforme as suas configurações. Com o perfil privado, só quem você aprova vê seus eventos postados, sua agenda e suas conexões. Mensagens só chegam a quem participa da conversa.',
          'Nós não vendemos seus dados pessoais e não usamos o que você faz no AskouT para anúncios de terceiros.',
        ],
      },
      {
        title: '5. Com quem compartilhamos para o serviço funcionar',
        items: [
          'Hospedagem e banco de dados (Railway) e rede, DNS e hospedagem do site (Cloudflare): guardam e entregam os dados do aplicativo.',
          'Envio de e-mail (Resend): recebe seu e-mail e o texto do código ou aviso.',
          'Busca de locais (Google Places e OpenStreetMap): recebem a região aproximada da sua consulta para devolver os locais perto, sem o seu nome nem a sua conta.',
          'Mapa: o provedor de mapas recebe o seu IP e a área do mapa que você está vendo.',
          'Pagamentos (Stripe, e as lojas da Apple e do Google no aplicativo): processam a cobrança do impulsionamento.',
          'Entrar com Google ou Apple: eles sabem que você entrou no AskouT.',
          'Autoridades, quando houver ordem legal.',
        ],
      },
      {
        title: '6. Transferência para fora do Brasil',
        text: ['Alguns desses fornecedores guardam ou processam dados em outros países. Quando isso acontece, buscamos fornecedores que ofereçam proteção adequada e contratos compatíveis com a LGPD.'],
      },
      {
        title: '7. Por quanto tempo guardamos',
        items: [
          'Os dados da conta e do conteúdo ficam enquanto a conta existir, ou até você apagar o conteúdo.',
          'Códigos de confirmação expiram em poucos minutos. Disponibilidade "Flash" some sozinha ao expirar.',
          'O histórico de tempo por conteúdo e a região podem ser apagados por você a qualquer momento em Privacidade.',
          'Podemos manter o mínimo necessário por mais tempo quando a lei exigir (por exemplo, registros fiscais de pagamentos) ou para defesa em processos.',
        ],
      },
      {
        title: '8. Seus direitos',
        text: [
          `Pela LGPD, você pode pedir: confirmação de que tratamos seus dados; acesso; correção; anonimização, bloqueio ou eliminação de dados desnecessários ou tratados fora da lei; portabilidade; informação sobre com quem compartilhamos; eliminação dos dados tratados com consentimento; e revogar o consentimento. Você também pode se opor a um tratamento e pedir revisão de decisões automatizadas.`,
          `Parte disso você faz sozinho no app, em Privacidade: editar o perfil, tornar o perfil privado, bloquear pessoas, desligar as recomendações, apagar a região e o histórico de uso, baixar uma cópia dos seus dados e apagar a sua conta. Ao apagar a conta, removemos o seu perfil, posts, comentários, mensagens, agenda e demais dados ligados a ela. Para os outros pedidos, escreva para ${email}. Respondemos em até 15 dias.`,
          'Se achar que seus dados foram tratados de forma incorreta, você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).',
        ],
      },
      {
        title: '9. Segurança',
        text: ['Usamos conexão criptografada (HTTPS), guardamos senhas de forma irreversível, limitamos tentativas de acesso e restringimos quem da equipe acessa os dados. Nenhum sistema é totalmente seguro: se houver um incidente que possa causar risco relevante a você, avisaremos você e a ANPD, como a lei determina.'],
      },
      {
        title: '10. Crianças e adolescentes',
        text: ['O AskouT é só para pessoas com 18 anos ou mais, e o cadastro não aceita quem tem menos que isso. Não queremos dados de menores de 18 anos: se soubermos que uma conta é de alguém abaixo dessa idade, vamos encerrá-la. [A revisar com advogado antes do lançamento: regras do ECA Digital (Lei 15.211/2025).]'],
      },
      {
        title: '11. Armazenamento no aparelho',
        text: ['Guardamos no seu aparelho apenas o necessário para o app funcionar: sessão de login, tema e preferências. Não usamos cookies de publicidade nem rastreadores de terceiros para anúncios.'],
      },
      {
        title: '12. Mudanças nesta política',
        text: [`Podemos atualizar esta política. Quando a mudança for relevante, avisaremos no aplicativo. A data da versão fica no topo desta página. Última atualização: ${LEGAL_UPDATED}.`],
      },
    ],
  };
}

export function buildTerms(email: string): LegalDoc {
  return {
    title: 'Termos de Uso',
    intro: `Estes termos valem para quem usa o AskouT, operado pela ${COMPANY.name}, CNPJ ${COMPANY.cnpj}, ${COMPANY.address}. Ao criar uma conta ou entrar, você concorda com eles e com a Política de Privacidade.`,
    blocks: [
      {
        title: '1. O que é o AskouT',
        text: ['Um aplicativo para combinar encontros presenciais com amigos e descobrir bares, locais e eventos. Dois perfis que se seguem mutuamente são "amigos" aqui.'],
      },
      {
        title: '2. Sua conta',
        items: [
          'Você precisa ter 18 anos ou mais para ter uma conta, e informar dados verdadeiros, inclusive a data de nascimento.',
          'Você é responsável pela sua senha e por tudo o que acontece na sua conta. Avise-nos se achar que alguém a usou.',
          'Cada pessoa pode ter uma conta. Contas falsas, que imitam outras pessoas ou são feitas para enganar, podem ser removidas.',
        ],
      },
      {
        title: '3. Seu conteúdo',
        text: [
          'Fotos, vídeos, textos e mensagens que você publica continuam sendo seus. Você nos dá permissão limitada, gratuita e só para operar o serviço, para guardar e mostrar esse conteúdo às pessoas que você escolheu, conforme as suas configurações de privacidade.',
          'Você garante que tem o direito de publicar o que publica, inclusive imagens de outras pessoas.',
        ],
      },
      {
        title: '4. O que não é permitido',
        items: [
          'Assediar, ameaçar, discriminar ou expor outras pessoas, e publicar conteúdo sexual envolvendo menores ou sem consentimento (que sempre será removido e poderá ser comunicado às autoridades).',
          'Publicar dados pessoais de terceiros, ou usar o app para golpes, spam ou propaganda não autorizada.',
          'Tentar burlar a segurança, adivinhar senhas, coletar dados em massa ou usar robôs sem autorização.',
          'Violar a lei ou direitos de terceiros.',
        ],
        text: ['Conteúdo ofensivo, de ódio, violento ou sexual não é tolerado e será removido; quem insistir terá a conta suspensa.'],
      },
      {
        title: '5. Denúncias, bloqueio e moderação',
        items: [
          'Você pode denunciar perfis, posts, comentários, stories e conversas pelo próprio app (menu de opções de cada item) e bloquear qualquer pessoa a qualquer momento.',
          'A nossa equipe analisa as denúncias, remove o que descumprir estes termos e pode suspender contas. [A revisar antes do lançamento: prazo de resposta. Meta atual: até 24 horas.]',
          `Para denúncias que não caibam no app ou casos urgentes, escreva para ${email}.`,
        ],
      },
      {
        title: '6. Locais, eventos e links de terceiros',
        text: [
          'As informações de locais e eventos vêm de donos de locais, de fontes públicas e de outros usuários, e podem estar desatualizadas ou incorretas. Confira horário e endereço antes de sair. Itens marcados como "[TESTE]" são apenas exemplos.',
          'O botão "Comprar ingresso" leva você ao site de venda de terceiros. O AskouT não vende, não cobra e não entrega ingressos, e não responde por esse site ou pela compra.',
          'Encontros presenciais envolvem riscos. Use bom senso, combine em locais públicos e cuide da sua segurança e da de quem está com você.',
        ],
      },
      {
        title: '7. Donos de locais e impulsionamento',
        text: ['Quem administra um local declara ter autorização para isso. O impulsionamento é um anúncio pago, sempre identificado como "Patrocinado". Preços, forma de cobrança e regras de cancelamento e reembolso são mostrados antes da compra. Reembolso: se o impulsionamento ainda não começou a ser exibido, você pode cancelar e receber o valor de volta; vale também o prazo de arrependimento de 7 dias do Código de Defesa do Consumidor para compras feitas fora de loja física. Se uma falha nossa impedir a exibição, devolvemos o valor proporcional ao período não entregue. Compras feitas pela Apple ou pelo Google seguem também as regras de reembolso da loja. [A revisar com advogado antes do lançamento.]'],
      },
      {
        title: '8. Suspensão e encerramento',
        text: ['Você pode parar de usar o AskouT quando quiser e pedir a exclusão da conta pelo e-mail de privacidade. Podemos suspender ou encerrar contas que descumpram estes termos, com aviso quando possível.'],
      },
      {
        title: '9. Responsabilidade',
        text: ['Oferecemos o AskouT como ele está, e nos esforçamos para mantê-lo no ar e seguro, mas não garantimos que nunca terá falhas. Na medida permitida em lei, não respondemos por encontros entre usuários, por conteúdo de terceiros nem por prejuízos indiretos. Nada aqui limita direitos que a lei garante a você como consumidor.'],
      },
      {
        title: '10. Mudanças, lei e foro',
        text: [
          `Podemos atualizar estes termos e avisaremos no aplicativo quando a mudança for relevante. Última atualização: ${LEGAL_UPDATED}.`,
          'Valem as leis do Brasil. Fica eleito o foro do domicílio do consumidor para resolver conflitos.',
          `Dúvidas: ${email}.`,
        ],
      },
    ],
  };
}
