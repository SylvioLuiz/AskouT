import { t } from './i18n/index.ts';
// Emojis do seletor (o "+" das reações), por categoria como no teclado do celular, com palavras para a busca.
// Cada linha é "emoji palavra palavra…"; as palavras são em português, com alguns termos em inglês que também se usam.

export type EmojiCategoryId = 'people' | 'nature' | 'food' | 'activity' | 'travel' | 'objects' | 'symbols' | 'flags';

export interface EmojiEntry {
  emoji: string;
  /** Palavras da busca, já sem acento e em minúsculas. */
  words: string;
}

export interface EmojiCategory {
  id: EmojiCategoryId;
  /** Emoji que representa a categoria na fileira de abas. */
  icon: string;
  items: EmojiEntry[];
}

const RAW: Record<EmojiCategoryId, string> = {
  people: `
😀 sorriso feliz alegre smile
😃 sorriso feliz alegre olhos grandes
😄 sorriso feliz rindo alegre
😁 sorriso dentes feliz
😆 rindo gargalhada feliz
😅 rindo suor nervoso alivio
🤣 rolando de rir gargalhada lol kkk
😂 chorando de rir lagrimas kkk lol
🙂 sorriso leve ok
🙃 de cabeca para baixo ironia
🫠 derretendo vergonha calor
😉 piscadinha piscar
😊 sorriso corado fofo feliz
😇 anjo inocente aureola
🥰 apaixonado coracoes amor carinho
😍 olhos de coracao apaixonado amor
🤩 estrelas nos olhos uau incrivel
😘 beijo coracao mwah
😗 beijo
☺️ sorriso tranquilo
😚 beijo olhos fechados
😙 beijo sorriso
🥲 sorriso com lagrima emocionado
😋 delicia gostoso lingua
😛 lingua de fora
😜 piscadinha lingua brincadeira
🤪 maluco doido zoeira
😝 lingua olhos fechados
🤑 dinheiro rico grana
🤗 abraco
🤭 mao na boca risadinha ops
🫢 surpresa mao na boca
🫣 espiando vergonha medo
🤫 silencio segredo psiu
🤔 pensando hmm duvida
🫡 continencia saudacao respeito
🤐 boca fechada ziper segredo
🤨 sobrancelha desconfiado
😐 neutro sem expressao
😑 sem expressao tedio
😶 sem boca mudo
🫥 invisivel pontilhado
😏 sorriso de lado malicioso
😒 desinteressado entediado
🙄 revirando os olhos tedio
😬 careta nervoso tenso
😮‍💨 suspiro alivio cansado
🤥 mentiroso pinoquio
😌 aliviado tranquilo
😔 pensativo triste
😪 sono cansado
🤤 babando fome desejo
😴 dormindo sono zzz
😷 mascara doente
🤒 doente febre termometro
🤕 machucado curativo
🤢 enjoado nauseado
🤮 vomitando nojo
🤧 espirrando gripe resfriado
🥵 calor quente suando
🥶 frio congelando gelado
🥴 tonto bebado zonzo
😵 tonto desmaiado
😵‍💫 tonto espiral confuso
🤯 cabeca explodindo chocado mente
🤠 cowboy chapeu
🥳 festa aniversario comemorando
🥸 disfarce oculos bigode
😎 oculos escuros legal descolado
🤓 nerd oculos
🧐 monoculo analisando
😕 confuso
🫤 boca torta indeciso
😟 preocupado
🙁 triste
☹️ triste carrancudo
😮 boca aberta surpreso uau
😯 surpreso espantado
😲 chocado espantado
😳 corado vergonha envergonhado
🥺 pidao suplicando por favor fofo
🥹 emocionado segurando lagrimas
😦 assustado
😧 angustiado
😨 com medo assustado
😰 ansioso suor frio
😥 triste aliviado
😢 chorando lagrima triste
😭 chorando muito triste aos prantos
😱 gritando de medo chocado
😖 confuso frustrado
😣 perseverante sofrendo
😞 decepcionado triste
😓 suor frio cansado
😩 exausto cansado
😫 cansado esgotado
🥱 bocejo sono tedio
😤 bufando bravo orgulhoso
😡 bravo com raiva furioso
😠 bravo irritado
🤬 xingando raiva palavrao
😈 diabinho malvado
👿 diabo bravo
💀 caveira morri morto kkk
☠️ caveira ossos perigo
💩 coco
🤡 palhaco
👹 ogro monstro
👺 goblin
👻 fantasma
👽 alien extraterrestre
👾 monstro videogame
🤖 robo
😺 gato sorrindo
😸 gato feliz
😹 gato chorando de rir
😻 gato apaixonado
😼 gato sorriso de lado
😽 gato beijo
🙀 gato assustado
😿 gato chorando
😾 gato bravo
🙈 macaco nao vejo vergonha
🙉 macaco nao ouco
🙊 macaco nao falo
👋 tchau oi aceno ola
🤚 mao levantada
🖐️ mao aberta cinco
✋ mao parar toca aqui
🖖 vulcano spock
🫱 mao direita
🫲 mao esquerda
👌 ok perfeito beleza
🤌 italiano gesto dedos juntos
🤏 pouquinho pitada
✌️ paz vitoria dois
🤞 dedos cruzados sorte
🫰 coracao com dedos
🤟 te amo rock
🤘 rock metal chifres
🤙 me liga hang loose
👈 apontando esquerda
👉 apontando direita
👆 apontando cima
🖕 dedo do meio
👇 apontando baixo
☝️ indicador um
🫵 voce apontando
👍 joinha legal curti positivo like ok
👎 nao curti negativo dislike
✊ punho levantado forca
👊 soco punho
🤛 soquinho esquerda
🤜 soquinho direita
👏 palmas aplausos parabens
🙌 maos levantadas comemorando aleluia
🫶 coracao com as maos amor
👐 maos abertas
🤲 palmas juntas
🤝 aperto de mao acordo trato
🙏 por favor obrigado reza amem
✍️ escrevendo
💅 unha esmalte
🤳 selfie
💪 forte musculo biceps forca
🦵 perna
🦶 pe
👂 orelha ouvido
👃 nariz
🧠 cerebro inteligente
🫀 coracao orgao
🫁 pulmao
🦷 dente
🦴 osso
👀 olhos olhando de olho
👁️ olho
👅 lingua
👄 boca labios
🫦 mordendo labio
👶 bebe
🧒 crianca
👦 menino
👧 menina
🧑 pessoa
👱 loiro
👨 homem
🧔 barba homem barbudo
👩 mulher
🧓 idoso
👴 vovo idoso
👵 vovo idosa
🙍 franzindo
🙎 bicudo
🙅 nao negando
🙆 ok certo
💁 atendente informacao
🙋 levantando a mao
🧏 surdo
🙇 reverencia desculpa
🤦 facepalm vergonha alheia
🤷 sei la tanto faz encolhendo ombros
👮 policial
🕵️ detetive
💂 guarda
👷 operario obra
🤴 principe
👸 princesa rainha
👳 turbante
🤵 noivo terno
👰 noiva casamento
🤰 gravida
🎅 papai noel natal
🤶 mamae noel natal
🦸 super heroi
🦹 vilao
🧙 mago bruxo
🧚 fada
🧛 vampiro
🧜 sereia
🧝 elfo
🧞 genio
🧟 zumbi
💆 massagem
💇 corte de cabelo
🚶 andando caminhando
🧍 em pe
🧎 ajoelhado
🏃 correndo pressa
💃 dancando danca balada
🕺 dancando danca balada
👯 dancarinas festa
🧖 sauna
🧗 escalando
🤺 esgrima
🏇 cavalo corrida
⛷️ esqui
🏂 snowboard
🏌️ golfe
🏄 surfe surfando
🚣 remando
🏊 nadando natacao
⛹️ basquete bola
🏋️ academia musculacao peso
🚴 bicicleta pedalando
🤸 estrelinha ginastica
🤼 luta
🤽 polo aquatico
🤾 handebol
🤹 malabarismo
🧘 yoga meditacao
🛀 banho
🛌 cama dormindo
👭 amigas
👫 casal
👬 amigos
💏 beijo casal
💑 casal apaixonado
👪 familia
🗣️ falando
👤 silhueta
👥 pessoas grupo
🫂 abraco
👣 pegadas`,
  nature: `
🐶 cachorro cao doguinho
🐱 gato gatinho
🐭 rato
🐹 hamster
🐰 coelho
🦊 raposa
🐻 urso
🐼 panda
🐻‍❄️ urso polar
🐨 coala
🐯 tigre
🦁 leao
🐮 vaca
🐷 porco
🐸 sapo
🐵 macaco
🐔 galinha
🐧 pinguim
🐦 passaro
🐤 pintinho
🦆 pato
🦅 aguia
🦉 coruja
🦇 morcego
🐺 lobo
🐗 javali
🐴 cavalo
🦄 unicornio
🐝 abelha
🪱 minhoca
🐛 lagarta
🦋 borboleta
🐌 caracol lesma
🐞 joaninha
🐜 formiga
🦟 mosquito pernilongo
🪳 barata
🕷️ aranha
🦂 escorpiao
🐢 tartaruga
🐍 cobra
🦎 lagarto
🐙 polvo
🦑 lula
🦐 camarao
🦞 lagosta
🦀 caranguejo
🐡 baiacu
🐠 peixe tropical
🐟 peixe
🐬 golfinho
🐳 baleia
🐋 baleia
🦈 tubarao
🐊 jacare crocodilo
🐅 tigre
🐆 leopardo onca
🦓 zebra
🦍 gorila
🐘 elefante
🦛 hipopotamo
🦏 rinoceronte
🐪 camelo
🦒 girafa
🦘 canguru
🐃 bufalo
🐄 vaca
🐎 cavalo
🐖 porco
🐑 ovelha
🐐 cabra bode
🦌 cervo veado
🐕 cachorro
🐩 poodle
🐈 gato
🐈‍⬛ gato preto
🐓 galo
🦃 peru
🦚 pavao
🦜 papagaio arara
🦢 cisne
🦩 flamingo
🕊️ pomba paz
🐇 coelho
🦝 guaxinim
🦥 bicho preguica
🦦 lontra
🐿️ esquilo
🦔 ourico
🐾 patinhas pegadas
🐉 dragao
🌵 cacto
🎄 arvore de natal
🌲 pinheiro
🌳 arvore
🌴 coqueiro palmeira praia
🌱 broto planta
🌿 erva folha
☘️ trevo
🍀 trevo quatro folhas sorte
🍃 folhas vento
🍂 folhas outono
🍁 folha bordo
🍄 cogumelo
🌾 trigo
💐 buque flores
🌷 tulipa flor
🌹 rosa flor
🥀 rosa murcha
🌺 hibisco flor
🌸 flor de cerejeira
🌼 flor
🌻 girassol
🌞 sol sorrindo
🌝 lua cheia rosto
🌚 lua nova rosto
🌙 lua noite
🌎 terra mundo planeta americas
🪐 planeta saturno
💫 tonto estrela brilho
⭐ estrela
🌟 estrela brilhante
✨ brilho brilhos magia
⚡ raio energia
☄️ cometa
💥 explosao
🔥 fogo foguinho top quente
🌪️ tornado
🌈 arco iris
☀️ sol
🌤️ sol nuvem
⛅ nublado
🌧️ chuva
⛈️ tempestade
❄️ neve floco frio
☃️ boneco de neve
⛄ boneco de neve
💨 vento rapido
💧 gota agua
💦 gotas suor agua
☔ guarda chuva chuva
🌊 onda mar praia`,
  food: `
🍏 maca verde
🍎 maca vermelha
🍐 pera
🍊 laranja
🍋 limao
🍌 banana
🍉 melancia
🍇 uva
🍓 morango
🫐 mirtilo
🍈 melao
🍒 cereja
🍑 pessego
🥭 manga
🍍 abacaxi
🥥 coco
🥝 kiwi
🍅 tomate
🍆 berinjela
🥑 abacate
🥦 brocolis
🥬 alface verdura
🥒 pepino
🌶️ pimenta
🫑 pimentao
🌽 milho
🥕 cenoura
🧄 alho
🧅 cebola
🥔 batata
🍠 batata doce
🥐 croissant
🥯 bagel
🍞 pao
🥖 baguete pao frances
🧀 queijo
🥚 ovo
🍳 ovo frito cozinhar
🧈 manteiga
🥞 panqueca
🧇 waffle
🥓 bacon
🥩 carne bife churrasco
🍗 frango coxa
🍖 carne osso
🌭 cachorro quente
🍔 hamburguer lanche
🍟 batata frita
🍕 pizza
🫓 pao chato
🥪 sanduiche
🌮 taco
🌯 burrito
🥗 salada
🥘 panela comida
🫕 fondue
🍝 macarrao espaguete
🍜 lamen sopa
🍲 sopa panela
🍛 curry arroz
🍣 sushi
🍱 bento japones
🥟 pastel guioza
🍤 camarao frito
🍙 bolinho de arroz
🍚 arroz
🍘 biscoito de arroz
🍥 kamaboko
🥠 biscoito da sorte
🍢 espetinho
🍡 dango
🍧 raspadinha
🍨 sorvete
🍦 sorvete casquinha
🥧 torta
🧁 cupcake bolinho
🍰 bolo fatia
🎂 bolo de aniversario
🍮 pudim
🍭 pirulito
🍬 bala doce
🍫 chocolate
🍿 pipoca cinema
🍩 donut rosquinha
🍪 cookie biscoito
🌰 castanha
🥜 amendoim
🍯 mel
🥛 leite
🍼 mamadeira
☕ cafe cafezinho
🍵 cha
🧃 suco caixinha
🥤 refrigerante copo
🧋 bubble tea
🍶 saque
🍺 cerveja chopp breja
🍻 brinde cervejas saude
🥂 brinde taças champanhe saude
🍷 vinho
🥃 whisky dose
🍸 drink coquetel martini
🍹 drink tropical caipirinha
🧉 chimarrao mate
🍾 champanhe comemorar
🧊 gelo
🥄 colher
🍴 talheres garfo faca
🍽️ prato jantar
🥢 hashi palitinhos`,
  activity: `
⚽ futebol bola
🏀 basquete
🏈 futebol americano
⚾ beisebol
🥎 softbol
🎾 tenis
🏐 volei
🏉 rugby
🥏 frisbee
🎱 sinuca bilhar
🪀 ioio
🏓 pingue pongue
🏸 badminton
🏒 hoquei
🥅 gol
⛳ golfe
🪁 pipa
🏹 arco e flecha
🎣 pesca
🤿 mergulho
🥊 boxe luva
🥋 judo karate
🎽 camiseta corrida
🛹 skate
🛼 patins
⛸️ patinacao
🎿 esqui
🛷 treno
🥌 curling
🎯 alvo dardos objetivo
🎮 videogame jogo controle
🕹️ joystick
🎲 dado jogo
🧩 quebra cabeca
♟️ xadrez
🎰 caca niquel cassino
🎳 boliche
🏆 trofeu campeao vitoria
🥇 medalha ouro primeiro
🥈 medalha prata segundo
🥉 medalha bronze terceiro
🏅 medalha
🎖️ medalha militar
🎗️ laco
🎫 ingresso bilhete
🎟️ ingressos
🎪 circo
🤹 malabarismo
🎭 teatro mascaras
🩰 bale sapatilha
🎨 arte pintura
🎬 cinema filme claquete
🎤 microfone karaoke cantar
🎧 fone musica
🎼 partitura
🎹 piano teclado
🥁 bateria tambor
🪘 tambor
🎷 saxofone
🎺 trompete
🎸 guitarra violao
🪕 banjo
🎻 violino
🎵 nota musical musica
🎶 notas musicais musica
🎉 festa comemoracao parabens confete
🎊 confete festa
🎈 balao aniversario
🎁 presente
🎀 laco presente
🪩 globo espelhado balada disco
🎆 fogos de artificio
🎇 estrelinha fogos
🧨 bombinha
🎃 abobora halloween
🎄 natal arvore`,
  travel: `
🚗 carro
🚕 taxi uber
🚙 suv carro
🚌 onibus
🚎 onibus eletrico
🏎️ carro de corrida
🚓 policia viatura
🚑 ambulancia
🚒 bombeiros
🚐 van
🛻 picape
🚚 caminhao
🚛 carreta
🚜 trator
🛵 moto scooter
🏍️ moto
🚲 bicicleta bike
🛴 patinete
🚨 sirene
🚔 viatura
🚍 onibus
🚘 carro
🚖 taxi
✈️ aviao viagem
🛫 decolagem
🛬 pouso
🚀 foguete
🛸 disco voador
🚁 helicoptero
⛵ veleiro barco
🚤 lancha
🛥️ barco
🛳️ navio cruzeiro
⛴️ balsa
🚢 navio
⚓ ancora
🚂 trem
🚆 trem
🚇 metro
🚊 bonde
🚉 estacao
⛽ posto gasolina
🚦 semaforo
🗺️ mapa
🗿 moai
🗽 estatua da liberdade
🗼 torre
🏰 castelo
🏯 castelo japones
🏟️ estadio
🎡 roda gigante
🎢 montanha russa
🎠 carrossel
⛲ fonte
⛱️ guarda sol praia
🏖️ praia
🏝️ ilha
🏜️ deserto
🌋 vulcao
⛰️ montanha
🏔️ montanha neve
🗻 monte fuji
🏕️ acampamento
⛺ barraca camping
🏠 casa
🏡 casa jardim
🏘️ casas
🏢 predio escritorio
🏬 shopping
🏣 correio
🏥 hospital
🏦 banco
🏨 hotel
🏪 loja conveniencia
🏫 escola
🏩 motel
💒 casamento igreja
🏛️ museu
⛪ igreja
🕌 mesquita
🕍 sinagoga
🌅 nascer do sol
🌄 nascer do sol montanha
🌠 estrela cadente
🎇 fogos
🎆 fogos de artificio
🌇 por do sol cidade
🌆 cidade entardecer
🏙️ cidade predios
🌃 noite estrelada cidade
🌌 via lactea
🌉 ponte noite
🌁 neblina
📍 pino local lugar localizacao`,
  objects: `
⌚ relogio
📱 celular telefone
💻 notebook computador
⌨️ teclado
🖥️ computador monitor
🖨️ impressora
🖱️ mouse
💽 disco
💾 disquete
💿 cd
📀 dvd
📷 camera foto
📸 camera flash foto
📹 filmadora
🎥 camera de filme
📞 telefone
☎️ telefone
📺 televisao tv
📻 radio
🎙️ microfone podcast
⏰ despertador
⌛ ampulheta tempo
⏳ ampulheta esperando
📡 antena
🔋 bateria
🪫 bateria fraca
🔌 tomada
💡 lampada ideia
🔦 lanterna
🕯️ vela
💸 dinheiro voando gastando
💵 dinheiro dolar
💰 saco de dinheiro grana
💳 cartao credito
💎 diamante joia
⚖️ balanca justica
🧰 caixa de ferramentas
🔧 chave inglesa
🔨 martelo
🛠️ ferramentas
⚙️ engrenagem configuracao
🧲 ima
🔫 pistola agua
💣 bomba
🔪 faca
🗡️ adaga
🛡️ escudo
🚬 cigarro
⚰️ caixao
🔮 bola de cristal
📿 terco
🧿 olho grego
💈 barbearia
🔭 telescopio
🔬 microscopio
💊 remedio pilula
💉 vacina injecao
🩹 curativo
🌡️ termometro
🧹 vassoura
🧺 cesta
🧻 papel higienico
🚽 vaso sanitario
🚿 chuveiro
🛁 banheira
🧼 sabonete
🪥 escova de dente
🧽 esponja
🛎️ campainha
🔑 chave
🗝️ chave antiga
🚪 porta
🪑 cadeira
🛋️ sofa
🛏️ cama
🧸 ursinho pelucia
🖼️ quadro
🛍️ sacolas compras
🛒 carrinho de compras mercado
🎁 presente
✉️ envelope carta
📩 envelope email
📨 email recebido
📦 caixa pacote entrega
🏷️ etiqueta
📜 pergaminho
📄 documento papel
📅 calendario data
📆 calendario
🗓️ agenda calendario
📇 fichario
📈 grafico subindo
📉 grafico caindo
📊 grafico barras
📋 prancheta
📌 alfinete fixar
📍 pino local
📎 clipe
✂️ tesoura
🗑️ lixeira
🔒 cadeado fechado
🔓 cadeado aberto
🔐 cadeado chave
📝 anotacao memo
✏️ lapis
🖊️ caneta
🖌️ pincel
🔍 lupa busca
📚 livros estudo
📖 livro aberto
📓 caderno
🔖 marcador
🧾 recibo nota
👓 oculos
🕶️ oculos escuros
👔 gravata camisa
👕 camiseta
👖 calca jeans
🧣 cachecol
🧤 luvas
🧥 casaco
🧦 meias
👗 vestido
👙 biquini
👘 quimono
👠 salto alto
👡 sandalia
👢 bota
👞 sapato
👟 tenis
🧢 bone
🎩 cartola
👑 coroa rei rainha
💍 anel alianca noivado
👜 bolsa
👛 carteira bolsinha
🎒 mochila
💼 maleta trabalho
🌂 guarda chuva`,
  symbols: `
❤️ coracao amor vermelho love
🧡 coracao laranja
💛 coracao amarelo
💚 coracao verde
💙 coracao azul
💜 coracao roxo
🖤 coracao preto
🤍 coracao branco
🤎 coracao marrom
💔 coracao partido
❤️‍🔥 coracao em chamas paixao
❤️‍🩹 coracao curado
❣️ coracao exclamacao
💕 dois coracoes amor
💞 coracoes girando
💓 coracao batendo
💗 coracao crescendo
💖 coracao brilhante
💘 coracao flecha cupido
💝 coracao laco presente
💟 coracao decorado
💌 carta de amor
💋 beijo marca de batom
💯 cem pontos perfeito
💢 raiva
💬 balao fala conversa
💭 balao pensamento
🗯️ balao raiva
💤 sono zzz
💮 flor branca
♨️ fonte termal
✅ certo feito check
☑️ caixa marcada
✔️ certo
❌ errado x nao
❎ x
➕ mais
➖ menos
➗ dividir
✖️ multiplicar
❓ pergunta interrogacao
❔ pergunta
❗ exclamacao atencao
❕ exclamacao
‼️ dupla exclamacao
⁉️ exclamacao interrogacao
⚠️ aviso atencao cuidado
🚫 proibido
⛔ entrada proibida
📛 cracha
🔞 proibido menores 18
📵 sem celular
🔇 mudo sem som
🔈 som
🔊 som alto volume
🔔 sino notificacao
🔕 sem notificacao
📣 megafone
📢 alto falante anuncio
🆗 ok
🆒 cool
🆕 novo new
🆓 gratis free
🆙 up
🆘 sos socorro
🔝 top
🔜 em breve soon
🔛 on
🔙 voltar back
🔚 fim end
♻️ reciclagem
💲 cifrao dinheiro
💱 cambio
©️ copyright
®️ registrado
™️ marca
🔴 circulo vermelho
🟠 circulo laranja
🟡 circulo amarelo
🟢 circulo verde
🔵 circulo azul
🟣 circulo roxo
⚫ circulo preto
⚪ circulo branco
🟥 quadrado vermelho
🟩 quadrado verde
🟦 quadrado azul
🔶 losango laranja
🔷 losango azul
🔺 triangulo vermelho
🔻 triangulo baixo
▶️ play
⏸️ pausa
⏹️ parar
⏺️ gravar
⏭️ proximo
⏮️ anterior
🔀 aleatorio
🔁 repetir
🔄 atualizar
⬆️ seta cima
⬇️ seta baixo
⬅️ seta esquerda
➡️ seta direita
↩️ voltar
🔃 recarregar
♈ aries
♉ touro
♊ gemeos
♋ cancer
♌ leao
♍ virgem
♎ libra
♏ escorpiao
♐ sagitario
♑ capricornio
♒ aquario
♓ peixes
☮️ paz
☯️ yin yang
✝️ cruz
☪️ lua crescente
🕉️ om
✡️ estrela de davi
♾️ infinito
🏳️‍🌈 bandeira arco iris lgbt orgulho
🏳️‍⚧️ bandeira trans
#️⃣ hashtag
*️⃣ asterisco
0️⃣ zero
1️⃣ um
2️⃣ dois
3️⃣ tres
4️⃣ quatro
5️⃣ cinco
6️⃣ seis
7️⃣ sete
8️⃣ oito
9️⃣ nove
🔟 dez`,
  flags: `
🇧🇷 brasil bandeira
🇵🇹 portugal bandeira
🇦🇷 argentina bandeira
🇺🇾 uruguai bandeira
🇵🇾 paraguai bandeira
🇨🇱 chile bandeira
🇧🇴 bolivia bandeira
🇵🇪 peru bandeira
🇨🇴 colombia bandeira
🇻🇪 venezuela bandeira
🇪🇨 equador bandeira
🇲🇽 mexico bandeira
🇺🇸 estados unidos eua bandeira
🇨🇦 canada bandeira
🇨🇺 cuba bandeira
🇪🇸 espanha bandeira
🇫🇷 franca bandeira
🇮🇹 italia bandeira
🇩🇪 alemanha bandeira
🇬🇧 reino unido inglaterra bandeira
🇮🇪 irlanda bandeira
🇳🇱 holanda paises baixos bandeira
🇧🇪 belgica bandeira
🇨🇭 suica bandeira
🇦🇹 austria bandeira
🇸🇪 suecia bandeira
🇳🇴 noruega bandeira
🇩🇰 dinamarca bandeira
🇫🇮 finlandia bandeira
🇵🇱 polonia bandeira
🇬🇷 grecia bandeira
🇹🇷 turquia bandeira
🇺🇦 ucrania bandeira
🇷🇺 russia bandeira
🇮🇱 israel bandeira
🇿🇦 africa do sul bandeira
🇳🇬 nigeria bandeira
🇦🇴 angola bandeira
🇲🇿 mocambique bandeira
🇨🇻 cabo verde bandeira
🇪🇬 egito bandeira
🇲🇦 marrocos bandeira
🇯🇵 japao bandeira
🇰🇷 coreia do sul bandeira
🇨🇳 china bandeira
🇮🇳 india bandeira
🇹🇭 tailandia bandeira
🇦🇺 australia bandeira
🇳🇿 nova zelandia bandeira
🏁 bandeira quadriculada chegada corrida
🚩 bandeira vermelha alerta
🏳️ bandeira branca
🏴 bandeira preta
🏴‍☠️ bandeira pirata`,
};

const ICONS: Record<EmojiCategoryId, string> = { people: '😀', nature: '🐻', food: '🍔', activity: '⚽', travel: '🚗', objects: '💡', symbols: '❤️', flags: '🏁' };

/** Minúsculas e sem acento, para a busca achar "coração" digitando "coracao" (e vice-versa). */
export function normalizeQuery(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function parse(raw: string): EmojiEntry[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const space = line.indexOf(' ');
      return space === -1 ? { emoji: line, words: '' } : { emoji: line.slice(0, space), words: normalizeQuery(line.slice(space + 1)) };
    });
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = (Object.keys(RAW) as EmojiCategoryId[]).map((id) => ({ id, icon: ICONS[id], items: parse(RAW[id]) }));

/** Nome da categoria, no idioma do aparelho. */
export function emojiCategoryLabel(id: EmojiCategoryId): string {
  switch (id) {
    case 'people':
      return t('Carinhas e pessoas');
    case 'nature':
      return t('Animais e natureza');
    case 'food':
      return t('Comida e bebida');
    case 'activity':
      return t('Atividades');
    case 'travel':
      return t('Viagens e lugares');
    case 'objects':
      return t('Objetos');
    case 'symbols':
      return t('Símbolos');
    case 'flags':
      return t('Bandeiras');
  }
}

/** Emojis cujas palavras começam com o que foi digitado (cada palavra digitada precisa bater). Sem repetir emoji. */
export function searchEmojis(query: string, limit = 120): string[] {
  const terms = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const seen = new Set<string>();
  const found: string[] = [];
  for (const category of EMOJI_CATEGORIES) {
    for (const item of category.items) {
      if (seen.has(item.emoji)) continue;
      const words = item.words.split(' ');
      // Cada termo digitado precisa bater no começo de alguma palavra do emoji ("cora verm" acha ❤️).
      if (terms.every((term) => words.some((w) => w.startsWith(term)))) {
        seen.add(item.emoji);
        found.push(item.emoji);
        if (found.length >= limit) return found;
      }
    }
  }
  return found;
}

// ---------- Usados recentemente ----------

const RECENT_KEY = 'askout.emoji.recent';
const RECENT_MAX = 24;

/** Emojis usados por último, do mais novo para o mais antigo. Sem acesso ao armazenamento, lista vazia. */
export function readRecentEmojis(storage: Storage | undefined): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string' && e.length > 0 && e.length <= 16).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Põe o emoji no começo da lista de recentes (sem repetir) e devolve a lista nova. */
export function pushRecentEmoji(storage: Storage | undefined, emoji: string): string[] {
  const next = [emoji, ...readRecentEmojis(storage).filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Sem armazenamento (aba anônima, cota cheia): só não lembra.
  }
  return next;
}
