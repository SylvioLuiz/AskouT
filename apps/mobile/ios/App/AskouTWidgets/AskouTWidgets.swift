import SwiftUI
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

enum Brand {
    static let ink = Color(red: 0.969, green: 0.953, blue: 1.0)
    static let muted = Color(red: 0.710, green: 0.678, blue: 0.812)
    static let card = Color(red: 20 / 255, green: 16 / 255, blue: 34 / 255)
    static let cardTop = Color(red: 38 / 255, green: 24 / 255, blue: 62 / 255)
    static let track = Color.white.opacity(0.12)
    static let pink = Color(red: 1.0, green: 0.310, blue: 0.690)
    static let violet = Color(red: 0.639, green: 0.361, blue: 1.0)
    static let gradient = LinearGradient(
        stops: [
            .init(color: Color(red: 1.0, green: 0.769, blue: 0.541), location: 0),
            .init(color: Color(red: 1.0, green: 0.435, blue: 0.569), location: 0.30),
            .init(color: pink, location: 0.55),
            .init(color: violet, location: 0.80),
            .init(color: Color(red: 0.353, green: 0.784, blue: 1.0), location: 1),
        ],
        startPoint: .leading,
        endPoint: .trailing
    )
    static let background = LinearGradient(colors: [cardTop, card], startPoint: .topLeading, endPoint: .bottomTrailing)
}

func appLink(_ path: String) -> URL? {
    URL(string: "br.com.askout:/" + (path.hasPrefix("/") ? path : "/" + path))
}

extension View {
    /// Fundo escuro da marca; no iOS 17+ pelo `containerBackground` (obrigatório), antes com a margem feita aqui.
    @ViewBuilder
    func brandBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { Brand.background }
        } else {
            padding(16).frame(maxWidth: .infinity, maxHeight: .infinity).background(Brand.background)
        }
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
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.06)))

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
        .description("O encontro do NOW ou o plano que está rolando agora, com quanto falta para acabar.")
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
            .widgetURL(appLink(active?.url ?? next?.url ?? "/agenda"))
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
                if let next = next { Text("Próximo: \(Words.when(next.startsAt, now: entry.date))").font(.system(size: 12)).foregroundStyle(.secondary) }
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
            VStack(alignment: .leading, spacing: 4) {
                Eyebrow(text: "Agora")
                Spacer(minLength: 0)
                Text("Nada rolando agora").font(.system(size: 15, weight: .bold)).foregroundStyle(Brand.ink)
                if let next = next {
                    Text("Próximo: \(Words.when(next.startsAt, now: entry.date))").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.gradient)
                    Text(next.title).font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1)
                } else {
                    Text("Ligue o NOW e veja quem está livre").font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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
