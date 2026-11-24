import SwiftUI
import UIKit
import WidgetKit

/// Widgets do AskouT para a tela inicial e a tela bloqueada do iPhone.
///
/// Os dados vêm de `GET /me/widgets` (apps/api/src/core/widget-service.ts), com o token que o app guarda no Keychain
/// compartilhado ao entrar (ShareSessionPlugin.swift). O app pede para recarregar ao entrar, ao sair e sempre que vai
/// para o segundo plano (WidgetsPlugin.swift); fora isso o iPhone busca de novo a cada ~30 min. Entre uma busca e
/// outra, a linha do tempo já sabe quando cada plano começa e termina, então "próximo" e "agora" trocam sozinhos.
@main
struct AskouTWidgetBundle: WidgetBundle {
    var body: some Widget {
        NextPlanWidget()
        ActivePlanWidget()
        AgendaWidget()
        NowFriendsWidget()
        NowComboWidget()
        // Conversas (ChatsWidget.swift): no iOS 17+ a pessoa escolhe tudo, só grupos ou só individuais.
        if #available(iOSApplicationExtension 17.0, *) {
            ChatsWidget()
        } else {
            ChatsLegacyWidget()
        }
    }
}

// MARK: - Linha do tempo

struct WidgetEntry: TimelineEntry {
    let date: Date
    let state: WidgetState
}

struct Provider: TimelineProvider {
    /// Galeria e primeira exibição: um exemplo; `active` mostra o exemplo do encontro ativo.
    var sampleActive = false

    private func sample(_ date: Date) -> WidgetSnapshot {
        sampleActive ? .sampleActive(at: date) : .sample(at: date)
    }

    func placeholder(in context: Context) -> WidgetEntry {
        WidgetEntry(date: Date(), state: .ready(sample(Date())))
    }

    func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
        if context.isPreview {
            completion(WidgetEntry(date: Date(), state: .ready(sample(Date()))))
            return
        }
        WidgetStore.load { state in completion(WidgetEntry(date: Date(), state: state)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
        WidgetStore.load { state in
            let now = Date()
            var entries = [WidgetEntry(date: now, state: state)]
            let refresh = now.addingTimeInterval(30 * 60)
            if case .ready(let snapshot) = state {
                for moment in snapshot.transitions(after: now).prefix(24) {
                    entries.append(WidgetEntry(date: moment, state: state))
                }
            }
            completion(Timeline(entries: entries, policy: .after(refresh)))
        }
    }
}

// MARK: - Marca

/// Cores da marca nos dois temas. Cada cor segue o `colorScheme` do ambiente, que `brandBackground()` fixa no tema
/// escolhido no app (ou deixa o do iPhone, no "Automático").
enum Brand {
    private static func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }

    private static func pair(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }

    static let ink = pair(light: rgb(0x1C1C1E), dark: rgb(0xF7F3FF))
    static let muted = pair(light: rgb(0x5C5C60), dark: rgb(0xB5ADCF))
    /// Contorno dos rostinhos: a cor do fundo.
    static let card = pair(light: rgb(0xFFFFFF), dark: rgb(0x141022))
    static let track = pair(light: rgb(0x000000, 0.10), dark: rgb(0xFFFFFF, 0.12))
    /// Fundo dos blocos e botões contornados.
    static let wash = pair(light: rgb(0x000000, 0.05), dark: rgb(0xFFFFFF, 0.06))
    static let pink = pair(light: rgb(0xD6248F), dark: rgb(0xFF4FB0))
    static let violet = pair(light: rgb(0x8A3FFC), dark: rgb(0xA35CFF))
    static let gradient = LinearGradient(
        stops: [
            .init(color: pair(light: rgb(0xE8590C), dark: rgb(0xFFC48A)), location: 0),
            .init(color: pair(light: rgb(0xE0336A), dark: rgb(0xFF6F91)), location: 0.30),
            .init(color: pink, location: 0.55),
            .init(color: violet, location: 0.80),
            .init(color: pair(light: rgb(0x1D8FD6), dark: rgb(0x5AC8FF)), location: 1),
        ],
        startPoint: .leading,
        endPoint: .trailing
    )

    static func background(for scheme: ColorScheme) -> LinearGradient {
        let colors: [Color] = scheme == .dark
            ? [Color(rgb(0x26183E)), Color(rgb(0x141022))]
            : [Color(rgb(0xFBEFF8)), Color(rgb(0xFFFFFF))]
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// Tema escolhido no app (Configuração › Tema e idioma), gravado no Keychain compartilhado pelo WidgetsPlugin.
enum WidgetTheme {
    /// `nil` no "Automático" (ou se o app ainda não gravou): segue o iPhone.
    static func forced() -> ColorScheme? {
        switch WidgetSession.theme() {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
}

/// Fixa o tema do app no widget inteiro: nas cores do conteúdo (pelo ambiente) e no fundo.
struct BrandBackground: ViewModifier {
    let forced: ColorScheme?
    @Environment(\.colorScheme) private var system

    @ViewBuilder
    func body(content: Content) -> some View {
        let scheme = forced ?? system
        if #available(iOSApplicationExtension 17.0, *) {
            content.environment(\.colorScheme, scheme).containerBackground(for: .widget) { Brand.background(for: scheme) }
        } else {
            content.environment(\.colorScheme, scheme).padding(16).frame(maxWidth: .infinity, maxHeight: .infinity).background(Brand.background(for: scheme))
        }
    }
}

func appLink(_ path: String) -> URL? {
    URL(string: "br.com.askout:/" + (path.hasPrefix("/") ? path : "/" + path))
}

extension View {
    /// Fundo da marca no tema do app (claro, escuro ou o do iPhone); no iOS 17+ pelo `containerBackground` (obrigatório),
    /// antes com a margem feita aqui.
    func brandBackground() -> some View {
        modifier(BrandBackground(forced: WidgetTheme.forced()))
    }

    /// Tela bloqueada: o iPhone pinta sozinho; só precisa declarar o fundo no iOS 17+.
    @ViewBuilder
    func accessoryBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}

/// "PRÓXIMO" / "AGORA" com o pontinho da marca.
struct Eyebrow: View {
    let text: String
    var color: Color = Brand.muted
    var live = false

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(live ? Brand.pink : Brand.violet).frame(width: 6, height: 6)
            Text(text.uppercased()).font(.system(size: 10, weight: .bold)).tracking(0.8).foregroundStyle(color).lineLimit(1)
        }
    }
}

struct Initial: View {
    let name: String
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Brand.pink, Brand.violet], startPoint: .topLeading, endPoint: .bottomTrailing))
            Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(.system(size: size * 0.45, weight: .heavy))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

/// Barra que anda sozinha do começo ao fim (o iPhone atualiza sem gastar uma busca).
struct TimeBar: View {
    let start: Date
    let end: Date

    var body: some View {
        ProgressView(timerInterval: start...max(end, start.addingTimeInterval(60)), countsDown: false, label: { EmptyView() }, currentValueLabel: { EmptyView() })
            .progressViewStyle(.linear)
            .tint(Brand.pink)
    }
}

struct LoggedOutView: View {
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: "AskouT")
            Spacer(minLength: 0)
            Text("Entre no AskouT").font(.system(size: compact ? 14 : 16, weight: .bold)).foregroundStyle(Brand.ink)
            Text("para ver seus planos aqui").font(.system(size: 12)).foregroundStyle(Brand.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 1. Próximo encontro

struct NextPlanWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "askout.next", provider: Provider()) { entry in
            NextPlanView(entry: entry)
        }
        .configurationDisplayName("Próximo encontro")
        .description("O próximo plano da sua agenda: quando, o quê e onde.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

struct NextPlanView: View {
    let entry: WidgetEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch entry.state {
        case .loggedOut:
            switch family {
            case .accessoryInline: Text("Entre no AskouT").accessoryBackground()
            case .accessoryCircular, .accessoryRectangular: Text("Entre no AskouT").font(.caption).accessoryBackground()
            default: LoggedOutView().brandBackground()
            }
        case .ready(let snapshot):
            content(snapshot.next(at: entry.date))
                .widgetURL(appLink(snapshot.next(at: entry.date)?.url ?? "/agenda"))
        }
    }

    @ViewBuilder
    private func content(_ plan: WidgetPlan?) -> some View {
        switch family {
        case .accessoryInline:
            Group {
                if let plan = plan { Text("\(Words.when(plan.startsAt, now: entry.date)) · \(plan.title)") } else { Text("Nada marcado") }
            }
            .accessoryBackground()
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    if let plan = plan {
                        Text(Words.hour(plan.startsAt)).font(.system(size: 15, weight: .bold)).minimumScaleFactor(0.6)
                        Text(Words.dayHeader(plan.startsAt, now: entry.date).prefix(3).lowercased()).font(.system(size: 10, weight: .semibold))
                    } else {
                        Image(systemName: "calendar").font(.system(size: 18, weight: .semibold))
                    }
                }
                .widgetAccentable()
            }
            .accessoryBackground()
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                if let plan = plan {
                    Label(Words.when(plan.startsAt, now: entry.date), systemImage: "calendar").font(.system(size: 13, weight: .bold)).widgetAccentable()
                    Text(plan.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    if let venue = plan.venueName { Text(venue).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1) }
                } else {
                    Label("AskouT", systemImage: "calendar").font(.system(size: 13, weight: .bold)).widgetAccentable()
                    Text("Nada marcado").font(.system(size: 14, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessoryBackground()
        case .systemMedium:
            medium(plan).brandBackground()
        default:
            small(plan).brandBackground()
        }
    }

    private func small(_ plan: WidgetPlan?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(text: "Próximo")
            Spacer(minLength: 0)
            if let plan = plan {
                Text(Words.when(plan.startsAt, now: entry.date))
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundStyle(Brand.gradient)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(plan.title).font(.system(size: 14, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(2)
                if let venue = plan.venueName { Text(venue).font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1) }
            } else {
                Text("Nada marcado").font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.ink)
                Text("Toque para ver a agenda").font(.system(size: 12)).foregroundStyle(Brand.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func medium(_ plan: WidgetPlan?) -> some View {
        HStack(spacing: 14) {
            VStack(spacing: 2) {
                let day = plan?.startsAt ?? entry.date
                Text(Words.dayHeader(day, now: entry.date).prefix(3).uppercased()).font(.system(size: 11, weight: .bold)).foregroundStyle(Brand.pink)
                Text("\(Calendar.current.component(.day, from: day))").font(.system(size: 34, weight: .heavy)).foregroundStyle(Brand.ink)
                if let plan = plan { Text(Words.hour(plan.startsAt)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.muted) }
            }
            .frame(width: 64)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 14).fill(Brand.wash))

            VStack(alignment: .leading, spacing: 4) {
                Eyebrow(text: "Próximo encontro")
                if let plan = plan {
                    Text(plan.title).font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(2)
                    if let venue = plan.venueName {
                        Label(venue, systemImage: "mappin.and.ellipse").font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1)
                    }
                    HStack(spacing: 4) {
                        Text("começa").foregroundStyle(Brand.muted)
                        Text(plan.startsAt, style: .relative).foregroundStyle(Brand.ink)
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                    if let people = Words.people(plan.people) {
                        Text(people).font(.system(size: 11)).foregroundStyle(Brand.muted)
                    }
                } else {
                    Text("Nada marcado por enquanto").font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.ink)
                    Text("Confirme presença num evento ou crie um encontro").font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - 2. Encontro ativo

struct ActivePlanWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "askout.active", provider: Provider(sampleActive: true)) { entry in
            ActivePlanView(entry: entry)
        }
        .configurationDisplayName("Encontro ativo")
        .description("O encontro do NOW ou o plano que está rolando agora. Sem encontro, atalhos para ligar o NOW e convidar alguém.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct ActivePlanView: View {
    let entry: WidgetEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch entry.state {
        case .loggedOut:
            if family == .accessoryRectangular { Text("Entre no AskouT").font(.caption).accessoryBackground() } else { LoggedOutView().brandBackground() }
        case .ready(let snapshot):
            let active = snapshot.active(at: entry.date)
            let next = snapshot.next(at: entry.date)
            Group {
                if family == .accessoryRectangular { rectangular(active, next: next).accessoryBackground() } else { card(active, next: next).brandBackground() }
            }
            // Sem encontro, o toque abre o NOW: no botão de ligar ou, já ligado, na lista de quem está livre.
            .widgetURL(appLink(active?.url ?? (snapshot.flashOn(at: entry.date) ? "/now" : NowIntent.turnOn)))
        }
    }

    private func rectangular(_ active: ActiveThing?, next: WidgetPlan?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            switch active {
            case .now(let m):
                Label("NOW com \(m.withName)", systemImage: "bolt.fill").font(.system(size: 13, weight: .bold)).widgetAccentable().lineLimit(1)
                Text(m.placeName ?? "Escolham o lugar").font(.system(size: 13)).lineLimit(1)
                TimeBar(start: m.startedAt, end: m.expiresAt)
            case .plan(let p):
                Label("Agora", systemImage: "sparkles").font(.system(size: 13, weight: .bold)).widgetAccentable()
                Text(p.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                TimeBar(start: p.startsAt, end: p.endsAt)
            case nil:
                Label("Nada rolando agora", systemImage: "moon.zzz").font(.system(size: 13, weight: .bold)).widgetAccentable()
                Text("Toque para ligar o NOW").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                if let next = next { Text("Próximo: \(Words.when(next.startsAt, now: entry.date))").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func card(_ active: ActiveThing?, next: WidgetPlan?) -> some View {
        let wide = family == .systemMedium
        switch active {
        case .now(let m):
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: "NOW ao vivo", color: Brand.pink, live: true)
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    Initial(name: m.withName, size: wide ? 40 : 32)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Com \(m.withName)").font(.system(size: wide ? 17 : 15, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(1)
                        Text(m.placeName ?? "Escolham o lugar").font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1)
                    }
                }
                TimeBar(start: m.startedAt, end: m.expiresAt)
                HStack(spacing: 4) {
                    Text("acaba em").foregroundStyle(Brand.muted)
                    Text(timerInterval: entry.date...max(m.expiresAt, entry.date), countsDown: true).foregroundStyle(Brand.ink).monospacedDigit()
                }
                .font(.system(size: 12, weight: .semibold))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .plan(let p):
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: "Rolando agora", color: Brand.pink, live: true)
                Spacer(minLength: 0)
                Text(p.title).font(.system(size: wide ? 17 : 15, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(2)
                if let venue = p.venueName { Text(venue).font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1) }
                TimeBar(start: p.startsAt, end: p.endsAt)
                Text("até \(Words.hour(p.endsAt))").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case nil:
            if wide { idleMedium(next: next) } else { idleSmall(next: next) }
        }
    }

    private var snapshot: WidgetSnapshot? {
        if case .ready(let s) = entry.state { return s }
        return nil
    }

    private var flashOn: Bool { snapshot?.flashOn(at: entry.date) ?? false }

    /// "NOW ligado até 21h · 3 amigos livres" ou o convite para ligar.
    private var idleLine: String {
        guard let s = snapshot, flashOn else { return "Ligue o NOW e veja quem está livre" }
        var parts = ["NOW ligado até \(Words.hour(s.flash.expiresAt ?? entry.date))"]
        if s.friendsOnNow.count > 0 { parts.append(s.friendsOnNow.count == 1 ? "1 amigo livre" : "\(s.friendsOnNow.count) amigos livres") }
        return parts.joined(separator: " · ")
    }

    /// Pequeno: um toque só (o widget pequeno não tem botões), que abre o NOW para ligar.
    private func idleSmall(next: WidgetPlan?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(text: "Agora", live: flashOn)
            Spacer(minLength: 0)
            Text("Nada rolando agora").font(.system(size: 15, weight: .bold)).foregroundStyle(Brand.ink)
            Text(idleLine).font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(2)
            Label(flashOn ? "Ver quem está livre" : "Ligar o NOW", systemImage: "bolt.fill")
                .font(.system(size: 12, weight: .bold)).foregroundStyle(Brand.gradient).lineLimit(1)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Médio: dois botões, ligar o NOW (ou ver quem está livre) e convidar alguém.
    private func idleMedium(next: WidgetPlan?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Eyebrow(text: "Agora", live: flashOn)
                Spacer(minLength: 0)
                if let pending = snapshot?.pendingInvites, pending > 0 {
                    Text(pending == 1 ? "1 convite" : "\(pending) convites").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(Brand.pink))
                }
            }
            Spacer(minLength: 0)
            Text("Nada rolando agora").font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.ink)
            Text(next.map { "\(idleLine) · Próximo: \(Words.when($0.startsAt, now: entry.date))" } ?? idleLine)
                .font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1)
            HStack(spacing: 8) {
                Link(destination: appLink(flashOn ? "/now" : NowIntent.turnOn) ?? URL(string: "br.com.askout://now")!) {
                    WidgetButton(title: flashOn ? "Quem está livre" : "Ligar o NOW", icon: "bolt.fill", primary: true)
                }
                Link(destination: appLink(NowIntent.invite) ?? URL(string: "br.com.askout://now")!) {
                    WidgetButton(title: "Convidar alguém", icon: "person.badge.plus", primary: false)
                }
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Pedidos que o widget faz à tela do NOW (lidos em apps/web/src/screens/flash.tsx, liberados em deep-link.ts).
enum NowIntent {
    static let turnOn = "/now?abrir=ligar"
    static let invite = "/now?abrir=convidar"
}

/// Botão do widget médio: cheio (degradê da marca) ou contornado.
struct WidgetButton: View {
    let title: String
    let icon: String
    let primary: Bool

    var body: some View {
        Label(title, systemImage: icon)
            .font(.system(size: 12, weight: .bold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(primary ? Color.white : Brand.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background {
                if primary {
                    Capsule().fill(LinearGradient(colors: [Brand.pink, Brand.violet], startPoint: .leading, endPoint: .trailing))
                } else {
                    Capsule().stroke(Brand.track, lineWidth: 1).background(Capsule().fill(Brand.wash))
                }
            }
    }
}

// MARK: - 3. Agenda

struct AgendaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "askout.agenda", provider: Provider()) { entry in
            AgendaView(entry: entry)
        }
        .configurationDisplayName("Agenda")
        .description("Seus próximos planos: encontros confirmados e eventos em que você vai.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct AgendaView: View {
    let entry: WidgetEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch entry.state {
        case .loggedOut:
            LoggedOutView().brandBackground()
        case .ready(let snapshot):
            list(snapshot.agenda(at: entry.date, limit: family == .systemLarge ? 6 : 3))
                .brandBackground()
                .widgetURL(appLink("/agenda"))
        }
    }

    private func list(_ plans: [WidgetPlan]) -> some View {
        VStack(alignment: .leading, spacing: family == .systemLarge ? 10 : 7) {
            HStack {
                Eyebrow(text: "Agenda")
                Spacer()
                Text("AskouT").font(.system(size: 11, weight: .heavy)).foregroundStyle(Brand.gradient)
            }
            if plans.isEmpty {
                Spacer(minLength: 0)
                Text("Nada marcado por enquanto").font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.ink)
                Text("Confirme presença num evento ou crie um encontro com os amigos").font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(2)
                Spacer(minLength: 0)
            } else {
                ForEach(Array(plans.enumerated()), id: \.element.key) { index, plan in
                    if family == .systemLarge, index == 0 || !Calendar.current.isDate(plans[index - 1].startsAt, inSameDayAs: plan.startsAt) {
                        Text(Words.dayHeader(plan.startsAt, now: entry.date)).font(.system(size: 11, weight: .bold)).foregroundStyle(Brand.pink)
                    }
                    Link(destination: appLink(plan.url) ?? URL(string: "br.com.askout://agenda")!) {
                        row(plan)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ plan: WidgetPlan) -> some View {
        HStack(spacing: 10) {
            Capsule().fill(plan.kind == "MEETUP" ? Brand.pink : Brand.violet).frame(width: 4, height: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(plan.title).font(.system(size: 14, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(1)
                Text([family == .systemLarge && plan.startsAt > entry.date ? Words.hour(plan.startsAt) : Words.when(plan.startsAt, now: entry.date), plan.venueName].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12))
                    .foregroundStyle(Brand.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if plan.startsAt <= entry.date {
                Text("agora").font(.system(size: 10, weight: .bold)).foregroundStyle(.white).padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(Brand.pink))
            }
        }
    }
}

// MARK: - 4. Amigos no NOW (sugestão extra)

struct NowFriendsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "askout.now", provider: Provider()) { entry in
            NowFriendsView(entry: entry)
        }
        .configurationDisplayName("Amigos no NOW")
        .description("Quantos amigos estão livres agora, convites do NOW e um atalho para ligar o seu.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct NowFriendsView: View {
    let entry: WidgetEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch entry.state {
        case .loggedOut:
            switch family {
            case .systemSmall: LoggedOutView(compact: true).brandBackground()
            case .accessoryCircular: ZStack { AccessoryWidgetBackground(); Image(systemName: "bolt.fill") }.accessoryBackground()
            default: Text("Entre no AskouT").font(.caption).accessoryBackground()
            }
        case .ready(let snapshot):
            content(snapshot).widgetURL(appLink("/now"))
        }
    }

    @ViewBuilder
    private func content(_ s: WidgetSnapshot) -> some View {
        let count = s.friendsOnNow.count
        let mineOn = s.flashOn(at: entry.date)
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "bolt.fill").font(.system(size: 12, weight: .bold))
                    Text("\(count)").font(.system(size: 20, weight: .heavy))
                }
                .widgetAccentable()
            }
            .accessoryBackground()
        case .accessoryInline:
            Label(count == 0 ? "Ninguém no NOW" : count == 1 ? "1 amigo livre agora" : "\(count) amigos livres agora", systemImage: "bolt.fill").accessoryBackground()
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label(count == 1 ? "1 amigo livre" : "\(count) amigos livres", systemImage: "bolt.fill").font(.system(size: 13, weight: .bold)).widgetAccentable()
                if count > 0 { Text(Words.names(s.friendsOnNow.people, total: count)).font(.system(size: 12)).lineLimit(1) }
                Text(mineOn ? "Seu NOW: até \(Words.hour(s.flash.expiresAt ?? entry.date))" : "Toque para ligar o seu").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessoryBackground()
        default:
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Eyebrow(text: "NOW", color: mineOn ? Brand.pink : Brand.muted, live: mineOn)
                    Spacer()
                    if s.pendingInvites > 0 {
                        Text("\(s.pendingInvites)").font(.system(size: 11, weight: .heavy)).foregroundStyle(.white).frame(minWidth: 18, minHeight: 18).background(Circle().fill(Brand.pink))
                    }
                }
                Spacer(minLength: 0)
                HStack(spacing: -8) {
                    ForEach(s.friendsOnNow.people.prefix(3), id: \.username) { f in
                        Initial(name: f.name, size: 26).overlay(Circle().stroke(Brand.card, lineWidth: 2))
                    }
                }
                Text(count == 0 ? "Ninguém livre" : count == 1 ? "1 amigo livre" : "\(count) amigos livres")
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if s.pendingInvites > 0 {
                    Text(s.pendingInvites == 1 ? "1 convite esperando" : "\(s.pendingInvites) convites esperando").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.pink).lineLimit(1)
                } else if mineOn {
                    Text("Seu NOW até \(Words.hour(s.flash.expiresAt ?? entry.date))").font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1)
                } else {
                    Text("Ligar o meu NOW →").font(.system(size: 12, weight: .bold)).foregroundStyle(Brand.gradient).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .brandBackground()
        }
    }
}

// MARK: - 5. NOW completo (encontro + quem está livre)

struct NowComboWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "askout.nowcombo", provider: Provider(sampleActive: true)) { entry in
            NowComboView(entry: entry)
        }
        .configurationDisplayName("NOW")
        .description("O encontro do NOW e quem está livre agora, juntos. Sem encontro, atalhos para ligar o NOW e convidar alguém.")
        .supportedFamilies([.systemMedium, .systemLarge, .accessoryRectangular])
    }
}

struct NowComboView: View {
    let entry: WidgetEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch entry.state {
        case .loggedOut:
            if family == .accessoryRectangular { Text("Entre no AskouT").font(.caption).accessoryBackground() } else { LoggedOutView().brandBackground() }
        case .ready(let s):
            let active = s.active(at: entry.date)
            Group {
                switch family {
                case .accessoryRectangular: rectangular(s, active: active).accessoryBackground()
                case .systemLarge: large(s, active: active).brandBackground()
                default: medium(s, active: active).brandBackground()
                }
            }
            .widgetURL(appLink(active?.url ?? (s.flashOn(at: entry.date) ? "/now" : NowIntent.turnOn)))
        }
    }

    private static let nowURL = URL(string: "br.com.askout://now")!

    private func freeText(_ count: Int) -> String {
        count == 0 ? "Ninguém livre" : count == 1 ? "1 amigo livre" : "\(count) amigos livres"
    }

    /// Tela bloqueada: a linha do encontro (ou "nada rolando") e a de quem está livre.
    private func rectangular(_ s: WidgetSnapshot, active: ActiveThing?) -> some View {
        let count = s.friendsOnNow.count
        return VStack(alignment: .leading, spacing: 1) {
            switch active {
            case .now(let m):
                Label("NOW com \(m.withName)", systemImage: "bolt.fill").font(.system(size: 13, weight: .bold)).widgetAccentable().lineLimit(1)
                TimeBar(start: m.startedAt, end: m.expiresAt)
            case .plan(let p):
                Label(p.title, systemImage: "sparkles").font(.system(size: 13, weight: .bold)).widgetAccentable().lineLimit(1)
                TimeBar(start: p.startsAt, end: p.endsAt)
            case nil:
                Label(s.flashOn(at: entry.date) ? "NOW ligado" : "Nada rolando agora", systemImage: "bolt.fill").font(.system(size: 13, weight: .bold)).widgetAccentable().lineLimit(1)
            }
            Text(count > 0 ? "\(freeText(count)): \(Words.names(s.friendsOnNow.people, total: count))" : "Ninguém livre agora")
                .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Lado do encontro: NOW ao vivo, plano rolando ou o atalho para ligar.
    @ViewBuilder
    private func meetup(_ s: WidgetSnapshot, active: ActiveThing?, big: Bool) -> some View {
        let mineOn = s.flashOn(at: entry.date)
        switch active {
        case .now(let m):
            VStack(alignment: .leading, spacing: 5) {
                Eyebrow(text: "NOW ao vivo", color: Brand.pink, live: true)
                Spacer(minLength: 0)
                HStack(spacing: 8) {
                    Initial(name: m.withName, size: big ? 40 : 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Com \(m.withName)").font(.system(size: big ? 17 : 14, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(1)
                        Text(m.placeName ?? "Escolham o lugar").font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1)
                    }
                }
                TimeBar(start: m.startedAt, end: m.expiresAt)
                HStack(spacing: 4) {
                    Text("acaba em").foregroundStyle(Brand.muted)
                    Text(timerInterval: entry.date...max(m.expiresAt, entry.date), countsDown: true).foregroundStyle(Brand.ink).monospacedDigit()
                }
                .font(.system(size: 12, weight: .semibold))
            }
        case .plan(let p):
            VStack(alignment: .leading, spacing: 5) {
                Eyebrow(text: "Rolando agora", color: Brand.pink, live: true)
                Spacer(minLength: 0)
                Text(p.title).font(.system(size: big ? 17 : 14, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(2)
                if let venue = p.venueName { Text(venue).font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1) }
                TimeBar(start: p.startsAt, end: p.endsAt)
                Text("até \(Words.hour(p.endsAt))").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.muted)
            }
        case nil:
            VStack(alignment: .leading, spacing: 5) {
                Eyebrow(text: mineOn ? "NOW ligado" : "Agora", color: mineOn ? Brand.pink : Brand.muted, live: mineOn)
                Spacer(minLength: 0)
                Text("Nada rolando agora").font(.system(size: big ? 17 : 14, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(2)
                Text(mineOn ? "Seu NOW até \(Words.hour(s.flash.expiresAt ?? entry.date))" : (s.next(at: entry.date).map { "Próximo: \(Words.when($0.startsAt, now: entry.date))" } ?? "Ligue o NOW e veja quem está livre"))
                    .font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1)
                HStack(spacing: 8) {
                    Link(destination: appLink(mineOn ? "/now" : NowIntent.turnOn) ?? Self.nowURL) {
                        WidgetButton(title: mineOn ? (big ? "Quem está livre" : "Ver o NOW") : "Ligar o NOW", icon: "bolt.fill", primary: true)
                    }
                    if big {
                        Link(destination: appLink(NowIntent.invite) ?? Self.nowURL) {
                            WidgetButton(title: "Convidar alguém", icon: "person.badge.plus", primary: false)
                        }
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    /// Lado de quem está livre: rostinhos, quantos e os nomes.
    private func friends(_ s: WidgetSnapshot) -> some View {
        let count = s.friendsOnNow.count
        return VStack(alignment: .leading, spacing: 5) {
            HStack {
                Eyebrow(text: "Livres")
                Spacer(minLength: 0)
                if s.pendingInvites > 0 {
                    Text("\(s.pendingInvites)").font(.system(size: 11, weight: .heavy)).foregroundStyle(.white).frame(minWidth: 18, minHeight: 18).background(Circle().fill(Brand.pink))
                }
            }
            Spacer(minLength: 0)
            if count > 0 {
                HStack(spacing: -8) {
                    ForEach(s.friendsOnNow.people.prefix(3), id: \.username) { f in
                        Initial(name: f.name, size: 26).overlay(Circle().stroke(Brand.card, lineWidth: 2))
                    }
                }
            }
            Text(freeText(count)).font(.system(size: 14, weight: .heavy)).foregroundStyle(Brand.ink).lineLimit(1).minimumScaleFactor(0.8)
            Text(count > 0 ? Words.names(s.friendsOnNow.people, total: count) : "Chame alguém pelo NOW")
                .font(.system(size: 11)).foregroundStyle(Brand.muted).lineLimit(2)
            if s.pendingInvites > 0 {
                Text(s.pendingInvites == 1 ? "1 convite" : "\(s.pendingInvites) convites").font(.system(size: 11, weight: .bold)).foregroundStyle(Brand.pink).lineLimit(1)
            }
        }
    }

    /// Médio: o encontro à esquerda, quem está livre à direita.
    private func medium(_ s: WidgetSnapshot, active: ActiveThing?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            meetup(s, active: active, big: false).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            Rectangle().fill(Brand.track).frame(width: 1)
            Link(destination: appLink("/now") ?? Self.nowURL) {
                friends(s).frame(maxHeight: .infinity, alignment: .leading)
            }
            .frame(width: 104)
        }
    }

    /// Grande: o encontro em cima (com os dois botões quando não há nada) e a lista de quem está livre embaixo.
    private func large(_ s: WidgetSnapshot, active: ActiveThing?) -> some View {
        let count = s.friendsOnNow.count
        return VStack(alignment: .leading, spacing: 10) {
            meetup(s, active: active, big: true).frame(maxWidth: .infinity, alignment: .leading).frame(height: 150)
            Rectangle().fill(Brand.track).frame(height: 1)
            HStack {
                Eyebrow(text: "Livres agora")
                Spacer(minLength: 0)
                if s.pendingInvites > 0 {
                    Text(s.pendingInvites == 1 ? "1 convite" : "\(s.pendingInvites) convites").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(Brand.pink))
                }
            }
            if count == 0 {
                Text("Ninguém livre agora").font(.system(size: 15, weight: .bold)).foregroundStyle(Brand.ink)
                Text("Ligue o seu NOW: quem estiver livre aparece aqui").font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(2)
            } else {
                Link(destination: appLink("/now") ?? Self.nowURL) {
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(s.friendsOnNow.people.prefix(4), id: \.username) { f in
                            HStack(spacing: 10) {
                                Initial(name: f.name, size: 26)
                                Text(f.name).font(.system(size: 14, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(1)
                                Spacer(minLength: 0)
                                Circle().fill(Brand.pink).frame(width: 6, height: 6)
                            }
                        }
                        if count > 4 {
                            Text("e mais \(count - 4)").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.muted)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }
}
