import AppIntents
import SwiftUI
import UIKit
import WidgetKit

/// Widget "Conversas", como o do WhatsApp: as últimas conversas com foto (ou iniciais), nome, prévia da última
/// mensagem, hora e não lidas. A pessoa escolhe se mostra tudo, só grupos ou só conversas individuais (no iOS 17+, ao
/// editar o widget; no iOS 16, mostra tudo).
///
/// Os dados vêm de `GET /me/widgets/chats?show=…` (apps/api/src/core/widget-service.ts, `chats`), com o mesmo token
/// e as mesmas regras da aba Conversas: sem quem tem bloqueio com você, sem solicitações de mensagem pendentes e com as
/// prévias que o app mostra ("Perfil compartilhado", "Foto", "Mensagem de voz"). Tocar numa linha abre a conversa;
/// no resto do widget, a lista de Conversas.

// MARK: - Dados

/// Filtro do widget (o mesmo `show` da API).
enum ChatsShow: String, Codable {
    case all, direct, group

    var title: String {
        switch self {
        case .all: return "Conversas"
        case .direct: return "Individuais"
        case .group: return "Grupos"
        }
    }

    var empty: String {
        switch self {
        case .all: return "Nenhuma conversa ainda"
        case .direct: return "Nenhuma conversa individual"
        case .group: return "Nenhum grupo ainda"
        }
    }
}

struct WidgetChat: Codable, Hashable {
    let id: String
    let type: String
    let title: String
    let initials: String
    let photoUrl: String?
    let preview: String
    let at: Date?
    let unread: Int
    let muted: Bool
    let pinned: Bool
    let url: String
}

struct WidgetChatsSnapshot: Codable {
    let now: Date
    let show: ChatsShow
    let unreadChats: Int
    let chats: [WidgetChat]

    static func sample(_ show: ChatsShow, at date: Date = Date()) -> WidgetChatsSnapshot {
        let m: TimeInterval = 60
        let all = [
            WidgetChat(id: "1", type: "GROUP", title: "Happy hour da firma", initials: "HF", photoUrl: nil, preview: "Bia: Bora às 19h no Bar do Zé?", at: date.addingTimeInterval(-4 * m), unread: 3, muted: false, pinned: true, url: "/conversas"),
            WidgetChat(id: "2", type: "DIRECT", title: "Ana Souza", initials: "AS", photoUrl: nil, preview: "Mensagem de voz (0:12)", at: date.addingTimeInterval(-26 * m), unread: 1, muted: false, pinned: false, url: "/conversas"),
            WidgetChat(id: "3", type: "DIRECT", title: "Caio Lima", initials: "CL", photoUrl: nil, preview: "Você: Perfil compartilhado", at: date.addingTimeInterval(-90 * m), unread: 0, muted: false, pinned: false, url: "/conversas"),
            WidgetChat(id: "4", type: "GROUP", title: "Aniversário da Bia", initials: "AB", photoUrl: nil, preview: "Dani: Foto", at: date.addingTimeInterval(-20 * 60 * m), unread: 12, muted: true, pinned: false, url: "/conversas"),
            WidgetChat(id: "5", type: "DIRECT", title: "Duda", initials: "D", photoUrl: nil, preview: "kkkkk combinado então", at: date.addingTimeInterval(-30 * 60 * m), unread: 0, muted: false, pinned: false, url: "/conversas"),
            WidgetChat(id: "6", type: "GROUP", title: "Vôlei de quinta", initials: "VQ", photoUrl: nil, preview: "Você: Compartilhou Show no parque", at: date.addingTimeInterval(-80 * 60 * m), unread: 0, muted: false, pinned: false, url: "/conversas"),
        ]
        let chats = all.filter { show == .all || (show == .group ? $0.type == "GROUP" : $0.type != "GROUP") }
        return WidgetChatsSnapshot(now: date, show: show, unreadChats: chats.filter { $0.unread > 0 && !$0.muted }.count, chats: chats)
    }
}

enum ChatsState {
    case loggedOut
    case ready(WidgetChatsSnapshot)
}

struct ChatsEntry: TimelineEntry {
    let date: Date
    let show: ChatsShow
    let state: ChatsState
    /// Fotos já baixadas e reduzidas, por id da conversa (sem foto: iniciais).
    var photos: [String: UIImage] = [:]
}

enum ChatsStore {
    private static func cacheKey(_ show: ChatsShow) -> String { "askout.widgets.chats.\(show.rawValue)" }

    static func cached(_ show: ChatsShow) -> WidgetChatsSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey(show)) else { return nil }
        return try? WidgetStore.decoder.decode(WidgetChatsSnapshot.self, from: data)
    }

    private static func forget() {
        for show in [ChatsShow.all, .direct, .group] { UserDefaults.standard.removeObject(forKey: cacheKey(show)) }
    }

    /// Busca na API com o token do app. Sem login (ou 401): `.loggedOut`. Sem rede: o último resultado guardado.
    static func load(_ show: ChatsShow) async -> ChatsState {
        guard let session = WidgetSession.load(), let url = URL(string: session.base + "/me/widgets/chats?show=\(show.rawValue)") else {
            forget()
            return .loggedOut
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let result = try? await URLSession.shared.data(for: request) {
            let data = result.0
            let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 {
                forget()
                return .loggedOut
            }
            if status == 200, let snapshot = try? WidgetStore.decoder.decode(WidgetChatsSnapshot.self, from: data) {
                if let encoded = try? WidgetStore.encoder.encode(snapshot) { UserDefaults.standard.set(encoded, forKey: cacheKey(show)) }
                return .ready(snapshot)
            }
        }
        return .ready(cached(show) ?? WidgetChatsSnapshot(now: Date(), show: show, unreadChats: 0, chats: []))
    }

    /// Fotos das linhas que cabem: data URL (foto do grupo) ou https (perfil, logo do local), reduzidas para o círculo.
    static func photos(for chats: [WidgetChat]) async -> [String: UIImage] {
        // As tarefas devolvem só os bytes (Data é Sendable); a imagem é montada aqui, fora delas.
        let raw = await withTaskGroup(of: (String, Data?).self, returning: [String: Data].self) { group in
            for chat in chats {
                guard let url = chat.photoUrl else { continue }
                let id = chat.id
                group.addTask { (id, await ChatsStore.bytes(from: url)) }
            }
            var out: [String: Data] = [:]
            for await (id, data) in group { if let data = data { out[id] = data } }
            return out
        }
        var out: [String: UIImage] = [:]
        for (id, data) in raw { if let picture = ChatsStore.circle(data) { out[id] = picture } }
        return out
    }

    private static func bytes(from raw: String) async -> Data? {
        if raw.hasPrefix("data:image/"), let comma = raw.firstIndex(of: ",") {
            return Data(base64Encoded: String(raw[raw.index(after: comma)...]))
        }
        guard raw.hasPrefix("https://"), let url = URL(string: raw) else { return nil }
        guard let result = try? await URLSession.shared.data(from: url) else { return nil }
        return result.0
    }

    /// O widget tem pouca memória: guarda só o tamanho do círculo.
    private static func circle(_ data: Data) -> UIImage? {
        guard let source = UIImage(data: data), source.size.width > 0, source.size.height > 0 else { return nil }
        let side: CGFloat = 96
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        return renderer.image { _ in
            let scale = max(side / source.size.width, side / source.size.height)
            let size = CGSize(width: source.size.width * scale, height: source.size.height * scale)
            source.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
    }

    static func entries(_ show: ChatsShow, rows: Int) async -> Timeline<ChatsEntry> {
        let state = await load(show)
        var photos: [String: UIImage] = [:]
        if case .ready(let snapshot) = state { photos = await ChatsStore.photos(for: Array(snapshot.chats.prefix(rows))) }
        let now = Date()
        var entries = [ChatsEntry(date: now, show: show, state: state, photos: photos)]
        // À meia-noite, "14:05" vira "Ontem" sem precisar buscar.
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime),
           midnight < now.addingTimeInterval(15 * 60) {
            entries.append(ChatsEntry(date: midnight, show: show, state: state, photos: photos))
        }
        return Timeline(entries: entries, policy: .after(now.addingTimeInterval(15 * 60)))
    }

    static func rows(for family: WidgetFamily) -> Int {
        family == .systemLarge ? 6 : 3
    }
}

// MARK: - Configuração (iOS 17+: "Editar widget" › Mostrar)

@available(iOSApplicationExtension 17.0, *)
enum ChatsShowOption: String, AppEnum {
    case all, direct, group

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Mostrar"
    static var caseDisplayRepresentations: [ChatsShowOption: DisplayRepresentation] = [
        .all: "Tudo",
        .direct: "Só individuais",
        .group: "Só grupos",
    ]

    var show: ChatsShow { ChatsShow(rawValue: rawValue) ?? .all }
}

@available(iOSApplicationExtension 17.0, *)
struct ChatsWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Conversas"
    static var description = IntentDescription("Escolha se o widget mostra todas as conversas, só os grupos ou só as individuais.")

    @Parameter(title: "Mostrar", default: .all)
    var show: ChatsShowOption
}

@available(iOSApplicationExtension 17.0, *)
struct ChatsIntentProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ChatsEntry {
        ChatsEntry(date: Date(), show: .all, state: .ready(.sample(.all)))
    }

    func snapshot(for configuration: ChatsWidgetIntent, in context: Context) async -> ChatsEntry {
        let show = configuration.show.show
        if context.isPreview { return ChatsEntry(date: Date(), show: show, state: .ready(.sample(show))) }
        return await ChatsStore.entries(show, rows: ChatsStore.rows(for: context.family)).entries[0]
    }

    func timeline(for configuration: ChatsWidgetIntent, in context: Context) async -> Timeline<ChatsEntry> {
        await ChatsStore.entries(configuration.show.show, rows: ChatsStore.rows(for: context.family))
    }
}

@available(iOSApplicationExtension 17.0, *)
struct ChatsWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "askout.chats", intent: ChatsWidgetIntent.self, provider: ChatsIntentProvider()) { entry in
            ChatsView(entry: entry)
        }
        .configurationDisplayName("Conversas")
        .description("Suas últimas conversas, com a prévia das mensagens. Escolha: tudo, só grupos ou só individuais.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

/// iOS 16 (sem App Intents nos widgets): mostra todas as conversas.
struct ChatsLegacyProvider: TimelineProvider {
    func placeholder(in context: Context) -> ChatsEntry {
        ChatsEntry(date: Date(), show: .all, state: .ready(.sample(.all)))
    }

    func getSnapshot(in context: Context, completion: @escaping (ChatsEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        let rows = ChatsStore.rows(for: context.family)
        Task { completion(await ChatsStore.entries(.all, rows: rows).entries[0]) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ChatsEntry>) -> Void) {
        let rows = ChatsStore.rows(for: context.family)
        Task { completion(await ChatsStore.entries(.all, rows: rows)) }
    }
}

struct ChatsLegacyWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "askout.chats", provider: ChatsLegacyProvider()) { entry in
            ChatsView(entry: entry)
        }
        .configurationDisplayName("Conversas")
        .description("Suas últimas conversas, com a prévia das mensagens.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - Textos

enum ChatWords {
    /// Como a lista de conversas do app: hoje "14:05", ontem "Ontem", na semana "seg", depois "25/10".
    static func time(_ date: Date?, now: Date) -> String {
        guard let date = date else { return "" }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: date), to: cal.startOfDay(for: now)).day ?? 0
        let f = DateFormatter()
        f.locale = Locale(identifier: "pt_BR")
        if days <= 0 {
            f.dateFormat = "HH:mm"
            return f.string(from: date)
        }
        if days == 1 { return "Ontem" }
        if days < 7 {
            f.dateFormat = "EEE"
            return f.string(from: date).replacingOccurrences(of: ".", with: "")
        }
        f.dateFormat = "dd/MM"
        return f.string(from: date)
    }

    static func count(_ n: Int) -> String { n > 99 ? "99+" : "\(n)" }
}

// MARK: - Desenho

struct ChatAvatar: View {
    let chat: WidgetChat
    let photo: UIImage?
    let size: CGFloat

    var body: some View {
        Group {
            if let photo = photo {
                Image(uiImage: photo).resizable().scaledToFill()
            } else {
                ZStack {
                    LinearGradient(colors: [Brand.pink, Brand.violet], startPoint: .topLeading, endPoint: .bottomTrailing)
                    Text(chat.initials)
                        .font(.system(size: size * (chat.initials.count > 1 ? 0.36 : 0.44), weight: .heavy))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.6)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

struct ChatRow: View {
    let chat: WidgetChat
    let photo: UIImage?
    let now: Date
    let compact: Bool

    var body: some View {
        let unread = chat.unread > 0
        HStack(spacing: 10) {
            ChatAvatar(chat: chat, photo: photo, size: compact ? 32 : 40)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(chat.title).font(.system(size: 14, weight: .bold)).foregroundStyle(Brand.ink).lineLimit(1)
                    if chat.muted { Image(systemName: "bell.slash.fill").font(.system(size: 9)).foregroundStyle(Brand.muted) }
                    Spacer(minLength: 4)
                    Text(ChatWords.time(chat.at, now: now))
                        .font(.system(size: 11, weight: unread ? .bold : .regular))
                        .foregroundStyle(unread && !chat.muted ? Brand.pink : Brand.muted)
                        .lineLimit(1)
                }
                HStack(spacing: 6) {
                    Text(chat.preview)
                        .font(.system(size: 12, weight: unread ? .semibold : .regular))
                        .foregroundStyle(unread ? Brand.ink.opacity(0.85) : Brand.muted)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if unread {
                        Text(ChatWords.count(chat.unread))
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Capsule().fill(chat.muted ? AnyShapeStyle(Brand.muted.opacity(0.6)) : AnyShapeStyle(Brand.pink)))
                    } else if chat.pinned {
                        Image(systemName: "pin.fill").font(.system(size: 10)).foregroundStyle(Brand.muted)
                    }
                }
            }
        }
        .contentShape(Rectangle())
    }
}

struct ChatsView: View {
    let entry: ChatsEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            switch entry.state {
            case .loggedOut:
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow(text: entry.show.title)
                    Spacer(minLength: 0)
                    Text("Entre no AskouT").font(.system(size: 16, weight: .bold)).foregroundStyle(Brand.ink)
                    Text("para ver suas conversas aqui").font(.system(size: 12)).foregroundStyle(Brand.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            case .ready(let snapshot):
                list(snapshot)
            }
        }
        .brandBackground()
        .widgetURL(appLink("/conversas"))
    }

    private func list(_ snapshot: WidgetChatsSnapshot) -> some View {
        let rows = Array(snapshot.chats.prefix(ChatsStore.rows(for: family)))
        let compact = family != .systemLarge
        return VStack(alignment: .leading, spacing: compact ? 4 : 8) {
            HStack(spacing: 6) {
                Eyebrow(text: entry.show.title)
                Spacer(minLength: 0)
                if snapshot.unreadChats > 0 {
                    Text(snapshot.unreadChats == 1 ? "1 não lida" : "\(ChatWords.count(snapshot.unreadChats)) não lidas")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Brand.pink)
                }
            }
            if rows.isEmpty {
                Spacer(minLength: 0)
                Text(entry.show.empty).font(.system(size: 15, weight: .bold)).foregroundStyle(Brand.ink)
                Text("Toque para abrir Conversas").font(.system(size: 12)).foregroundStyle(Brand.muted)
                Spacer(minLength: 0)
            } else {
                ForEach(rows, id: \.id) { chat in
                    if let url = appLink(chat.url) {
                        Link(destination: url) { ChatRow(chat: chat, photo: entry.photos[chat.id], now: entry.date, compact: compact) }
                    } else {
                        ChatRow(chat: chat, photo: entry.photos[chat.id], now: entry.date, compact: compact)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
