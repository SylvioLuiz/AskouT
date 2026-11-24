import Foundation
import Security

// MARK: - Dados (GET /me/widgets, ver apps/api/src/core/widget-service.ts)

/// Um plano da agenda pessoal: encontro confirmado ou evento com "Eu vou".
struct WidgetPlan: Codable, Hashable {
    let key: String
    let kind: String
    let title: String
    let startsAt: Date
    let endsAt: Date
    let venueName: String?
    let url: String
    let people: Int?
}

/// Encontro do NOW aceito e ainda valendo.
struct WidgetNowMatch: Codable, Hashable {
    let id: String
    let withName: String
    let startedAt: Date
    let expiresAt: Date
    let placeName: String?
    let url: String
}

struct WidgetFriend: Codable, Hashable {
    let name: String
    let username: String
}

struct WidgetSnapshot: Codable {
    struct Flash: Codable { let on: Bool; let expiresAt: Date? }
    struct Friends: Codable { let count: Int; let people: [WidgetFriend] }

    let now: Date
    let plans: [WidgetPlan]
    let matches: [WidgetNowMatch]
    let flash: Flash
    let friendsOnNow: Friends
    let pendingInvites: Int

    /// Exemplo da galeria de widgets (quando a pessoa escolhe qual adicionar).
    static func sample(at date: Date = Date()) -> WidgetSnapshot {
        let h: TimeInterval = 3600
        let today = Calendar.current.startOfDay(for: date)
        let tonight = max(date.addingTimeInterval(2 * h), today.addingTimeInterval(20 * h))
        return WidgetSnapshot(
            now: date,
            plans: [
                WidgetPlan(key: "m:1", kind: "MEETUP", title: "Happy hour da firma", startsAt: tonight, endsAt: tonight.addingTimeInterval(3 * h), venueName: "Bar do Zé", url: "/agenda", people: 5),
                WidgetPlan(key: "e:2", kind: "EVENT", title: "Show no parque", startsAt: tonight.addingTimeInterval(22 * h), endsAt: tonight.addingTimeInterval(25 * h), venueName: "Ibirapuera", url: "/agenda", people: nil),
                WidgetPlan(key: "m:3", kind: "MEETUP", title: "Aniversário da Bia", startsAt: tonight.addingTimeInterval(72 * h), endsAt: tonight.addingTimeInterval(76 * h), venueName: "Casa da Bia", url: "/agenda", people: 12),
                WidgetPlan(key: "e:4", kind: "EVENT", title: "Cinema ao ar livre", startsAt: tonight.addingTimeInterval(120 * h), endsAt: tonight.addingTimeInterval(123 * h), venueName: "Praça Roosevelt", url: "/agenda", people: nil),
            ],
            matches: [],
            flash: Flash(on: false, expiresAt: nil),
            friendsOnNow: Friends(count: 3, people: [WidgetFriend(name: "Ana", username: "ana"), WidgetFriend(name: "Caio", username: "caio"), WidgetFriend(name: "Bia", username: "bia")]),
            pendingInvites: 1
        )
    }

    /// Exemplo do "encontro ativo" na galeria.
    static func sampleActive(at date: Date = Date()) -> WidgetSnapshot {
        let base = sample(at: date)
        return WidgetSnapshot(
            now: date,
            plans: base.plans,
            matches: [WidgetNowMatch(id: "x", withName: "Ana", startedAt: date.addingTimeInterval(-600), expiresAt: date.addingTimeInterval(5400), placeName: "Bar do Zé", url: "/now")],
            flash: Flash(on: true, expiresAt: date.addingTimeInterval(5400)),
            friendsOnNow: base.friendsOnNow,
            pendingInvites: 0
        )
    }
}

/// O que está acontecendo agora: encontro do NOW ou um plano que já começou.
enum ActiveThing: Hashable {
    case now(WidgetNowMatch)
    case plan(WidgetPlan)

    var url: String {
        switch self {
        case .now(let m): return m.url
        case .plan(let p): return p.url
        }
    }
}

extension WidgetSnapshot {
    /// Encontro do NOW tem prioridade (é agora mesmo); senão, o plano que começou e não terminou.
    func active(at date: Date) -> ActiveThing? {
        if let match = matches.first(where: { $0.expiresAt > date }) { return .now(match) }
        if let plan = plans.first(where: { $0.startsAt <= date && $0.endsAt > date }) { return .plan(plan) }
        return nil
    }

    /// O próximo plano que ainda não começou.
    func next(at date: Date) -> WidgetPlan? {
        plans.first { $0.startsAt > date }
    }

    /// Agenda a partir de `date` (o que está rolando e o que vem).
    func agenda(at date: Date, limit: Int) -> [WidgetPlan] {
        Array(plans.filter { $0.endsAt > date }.prefix(limit))
    }

    func flashOn(at date: Date) -> Bool {
        flash.on && (flash.expiresAt.map { $0 > date } ?? true)
    }

    /// Instantes em que o widget muda sozinho (começo e fim dos planos, fim dos encontros e do NOW).
    func transitions(after date: Date) -> [Date] {
        var out = Set<Date>()
        for p in plans { out.insert(p.startsAt); out.insert(p.endsAt) }
        for m in matches { out.insert(m.expiresAt) }
        if let end = flash.expiresAt { out.insert(end) }
        return out.filter { $0 > date }.sorted()
    }
}

// MARK: - Textos

enum Words {
    private static let locale = Locale(identifier: "pt_BR")

    private static func hm(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        let h = c.hour ?? 0, m = c.minute ?? 0
        return m == 0 ? "\(h)h" : "\(h)h\(String(format: "%02d", m))"
    }

    /// "Agora", "Hoje 20h", "Amanhã 20h30", "sáb 20h" (na semana) ou "25/10 20h", como a agenda do app.
    static func when(_ start: Date, now: Date) -> String {
        if start <= now { return "Agora" }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: start)).day ?? 0
        if days == 0 { return "Hoje \(hm(start))" }
        if days == 1 { return "Amanhã \(hm(start))" }
        let f = DateFormatter()
        f.locale = locale
        if days < 7 {
            f.dateFormat = "EEE"
            return "\(f.string(from: start).replacingOccurrences(of: ".", with: "")) \(hm(start))"
        }
        f.dateFormat = "dd/MM"
        return "\(f.string(from: start)) \(hm(start))"
    }

    /// Só a hora ("20h", "20h30"), para os espaços pequenos.
    static func hour(_ date: Date) -> String { hm(date) }

    /// "seg", "hoje", "amanhã" (cabeçalho do dia na agenda).
    static func dayHeader(_ date: Date, now: Date) -> String {
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: date)).day ?? 0
        if days <= 0 { return "Hoje" }
        if days == 1 { return "Amanhã" }
        let f = DateFormatter()
        f.locale = locale
        f.dateFormat = days < 7 ? "EEEE" : "EEE, d 'de' MMM"
        return f.string(from: date).replacingOccurrences(of: ".", with: "").capitalized(with: locale)
    }

    static func people(_ n: Int?) -> String? {
        guard let n = n, n > 1 else { return nil }
        return "\(n) confirmados"
    }

    /// "Ana, Caio e mais 2".
    static func names(_ friends: [WidgetFriend], total: Int) -> String {
        let shown = friends.prefix(2).map(\.name)
        let rest = total - shown.count
        if shown.isEmpty { return "" }
        if rest <= 0 { return shown.joined(separator: " e ") }
        return shown.joined(separator: ", ") + " e mais \(rest)"
    }
}

// MARK: - Sessão (Keychain compartilhado com o app, o mesmo da folha de compartilhar)

enum WidgetSession {
    static let service = "br.com.askout.session"

    static var accessGroup: String? {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String, !prefix.isEmpty else { return nil }
        return "\(prefix)br.com.askout.shared"
    }

    /// Token e endereço da API que o app grava ao entrar (ShareSessionPlugin.swift); `nil` sem login neste iPhone.
    static func load() -> (token: String, base: String)? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "session",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let group = accessGroup { query[kSecAttrAccessGroup as String] = group }
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let token = json["token"], !token.isEmpty, let base = json["apiBase"], base.hasPrefix("http") else { return nil }
        return (token, base.hasSuffix("/") ? String(base.dropLast()) : base)
    }
}

// MARK: - Busca e cache

enum WidgetState {
    case loggedOut
    case ready(WidgetSnapshot)
}

enum WidgetStore {
    private static let cacheKey = "askout.widgets.snapshot"

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = WidgetStore.iso(raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "data inválida: \(raw)"))
        }
        return d
    }()

    private static func iso(_ raw: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: raw) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: raw)
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try c.encode(f.string(from: date))
        }
        return e
    }()

    /// Último resultado bom, para mostrar algo sem internet (cada extensão tem o seu armazenamento).
    static var cached: WidgetSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? decoder.decode(WidgetSnapshot.self, from: data)
    }

    /// Busca na API com o token do app. Sem login: `.loggedOut`. Sem rede ou erro do servidor: o último cache.
    static func load(completion: @escaping (WidgetState) -> Void) {
        guard let session = WidgetSession.load(), let url = URL(string: session.base + "/me/widgets") else {
            UserDefaults.standard.removeObject(forKey: cacheKey)
            completion(.loggedOut)
            return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 {
                UserDefaults.standard.removeObject(forKey: cacheKey)
                completion(.loggedOut)
                return
            }
            if status == 200, let data = data, let snapshot = try? decoder.decode(WidgetSnapshot.self, from: data) {
                if let encoded = try? encoder.encode(snapshot) { UserDefaults.standard.set(encoded, forKey: cacheKey) }
                completion(.ready(snapshot))
                return
            }
            if let cached = cached { completion(.ready(cached)) } else { completion(.ready(WidgetSnapshot.empty)) }
        }.resume()
    }
}

extension WidgetSnapshot {
    static var empty: WidgetSnapshot {
        WidgetSnapshot(now: Date(), plans: [], matches: [], flash: Flash(on: false, expiresAt: nil), friendsOnNow: Friends(count: 0, people: []), pendingInvites: 0)
    }
}
