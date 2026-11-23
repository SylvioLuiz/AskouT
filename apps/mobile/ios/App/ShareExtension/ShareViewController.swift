import SwiftUI
import UIKit
import UniformTypeIdentifiers

// "Compartilhar com o AskouT" no iPhone (Share Extension), no padrão dos apps de mensagem (WhatsApp, Telegram):
// a folha mostra as conversas e os amigos, a pessoa escolhe para quem vai (uma ou várias), escreve uma mensagem
// opcional e envia sem sair do app em que estava. Fotos, vídeos, PDF, documentos e links.
//
// Sessão: o app grava o token e o endereço da API no Keychain compartilhado (ShareSessionPlugin.swift, grupo
// "<TeamID>.br.com.askout.shared"); sem sessão, a folha pede para entrar no AskouT primeiro.
// Os envios usam as mesmas rotas do app: /conversations, /me/friends, /conversations/:id/media, /files e /messages.

final class ShareViewController: UIViewController {
    private var model: ShareModel?

    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        self.model = model
        let host = UIHostingController(rootView: ShareRootView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        model.start()
    }
}

// MARK: - Sessão (Keychain compartilhado com o app)

enum SharedSession {
    static let service = "br.com.askout.session"

    static var accessGroup: String? {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String, !prefix.isEmpty else { return nil }
        return "\(prefix)br.com.askout.shared"
    }

    /// Token e endereço da API gravados pelo app; `nil` se a pessoa não entrou no AskouT neste iPhone.
    static func load() -> (token: String, base: URL)? {
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
              let token = json["token"], !token.isEmpty, let raw = json["apiBase"], let base = URL(string: raw) else { return nil }
        return (token, base)
    }
}

// MARK: - Modelos

struct Person: Decodable {
    let userId: String
    let username: String
    let displayName: String
    let avatarUrl: String?
}

struct Conversation: Decodable {
    let id: String
    let type: String
    let other: Person?
    let name: String?
    let imageUrl: String?
    let canSend: Bool
}

struct ConversationList: Decodable {
    let items: [Conversation]
}

struct OpenedConversation: Decodable {
    let id: String
}

/// Para quem enviar: conversa que já existe ou amigo (a conversa 1 a 1 abre na hora de enviar).
struct Target: Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String
    let photo: String?
    let conversationId: String?
    let userId: String?
}

/// O que veio do outro app, já pronto para enviar.
enum Payload {
    case image(Data)
    case video(URL, mime: String)
    case file(URL, name: String, mime: String)
}

struct ApiFailure: Error {
    let message: String
}

// MARK: - Tipos de documento (os mesmos do servidor: apps/api/src/core/media.ts)

enum DocumentTypes {
    static let byExtension: [String: String] = [
        "pdf": "application/pdf",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls": "application/vnd.ms-excel",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt": "application/vnd.ms-powerpoint",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt": "application/vnd.oasis.opendocument.text",
        "ods": "application/vnd.oasis.opendocument.spreadsheet",
        "odp": "application/vnd.oasis.opendocument.presentation",
        "rtf": "application/rtf",
        "txt": "text/plain",
        "csv": "text/csv",
    ]
    static let maxFileBytes = 25 * 1024 * 1024
    static let maxVideoBytes = 60 * 1024 * 1024
    static let maxImageBytes = 2 * 1024 * 1024
}

// MARK: - Estado da folha

@MainActor
final class ShareModel: ObservableObject {
    @Published var phase: Phase = .loading
    @Published var targets: [Target] = []
    @Published var chosen: [String] = []
    @Published var query = ""
    @Published var caption = ""
    @Published var sharedText = ""
    @Published var payloads: [Payload] = []
    @Published var skipped = 0
    @Published var status: String?
    @Published var problem: String?

    enum Phase {
        case loading
        case needsLogin
        case ready
        case sending
    }

    private weak var context: NSExtensionContext?
    private var session: (token: String, base: URL)?
    static let maxTargets = 10

    init(context: NSExtensionContext?) {
        self.context = context
    }

    func start() {
        guard let session = SharedSession.load() else {
            phase = .needsLogin
            return
        }
        self.session = session
        Task {
            async let items: Void = loadAttachments()
            async let people: Void = loadTargets()
            _ = await (items, people)
            if phase == .loading { phase = .ready }
        }
    }

    var shown: [Target] {
        let q = fold(query.trimmingCharacters(in: .whitespaces))
        guard !q.isEmpty else { return targets }
        return targets.filter { fold("\($0.title) \($0.subtitle)").contains(q) }
    }

    var canSend: Bool {
        phase == .ready && !chosen.isEmpty && (!payloads.isEmpty || !sharedText.isEmpty || !caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var summary: String {
        var parts: [String] = []
        let images = payloads.filter { if case .image = $0 { return true } else { return false } }.count
        let videos = payloads.filter { if case .video = $0 { return true } else { return false } }.count
        let files = payloads.count - images - videos
        if images > 0 { parts.append(images == 1 ? "1 foto" : "\(images) fotos") }
        if videos > 0 { parts.append(videos == 1 ? "1 vídeo" : "\(videos) vídeos") }
        if files > 0 { parts.append(files == 1 ? "1 arquivo" : "\(files) arquivos") }
        if !sharedText.isEmpty { parts.append(sharedText.hasPrefix("http") ? "link" : "texto") }
        return parts.joined(separator: " · ")
    }

    func toggle(_ target: Target) {
        if let i = chosen.firstIndex(of: target.id) {
            chosen.remove(at: i)
        } else if chosen.count < Self.maxTargets {
            chosen.append(target.id)
        }
    }

    func cancel() {
        context?.cancelRequest(withError: NSError(domain: "br.com.askout.share", code: NSUserCancelledError))
    }

    // MARK: Carregar

    private func loadTargets() async {
        guard let session else { return }
        do {
            let convs: ConversationList = try await get("conversations", session)
            let friends: [Person] = (try? await get("me/friends", session)) ?? []
            var list: [Target] = []
            var withChat = Set<String>()
            for c in convs.items where c.canSend {
                if let o = c.other {
                    withChat.insert(o.userId)
                    list.append(Target(id: "c:\(c.id)", title: o.displayName, subtitle: "@\(o.username)", photo: o.avatarUrl, conversationId: c.id, userId: nil))
                } else {
                    list.append(Target(id: "c:\(c.id)", title: c.name ?? "Grupo", subtitle: "Grupo", photo: c.imageUrl, conversationId: c.id, userId: nil))
                }
            }
            for f in friends where !withChat.contains(f.userId) {
                list.append(Target(id: "u:\(f.userId)", title: f.displayName, subtitle: "@\(f.username)", photo: f.avatarUrl, conversationId: nil, userId: f.userId))
            }
            targets = list
        } catch let failure as ApiFailure {
            if failure.message == "401" { phase = .needsLogin } else { problem = failure.message }
        } catch {
            problem = "Sem conexão. Tente de novo."
        }
    }

    private func loadAttachments() async {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        var texts: [String] = []
        for provider in providers.prefix(10) {
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                if let data = await loadImage(provider) { payloads.append(.image(data)) } else { skipped += 1 }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                if let movie = await loadMovie(provider) { payloads.append(.video(movie.0, mime: movie.1)) } else { skipped += 1 }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) || provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) || provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) && !provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) && !provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let file = await loadDocument(provider) { payloads.append(file) } else { skipped += 1 }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL { texts.append(url.absoluteString) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String { texts.append(text) }
            }
        }
        sharedText = String(texts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))
    }

    /// Foto reduzida (lado maior até 1600 px) em JPEG, até 2 MB, como o app faz antes de enviar.
    private func loadImage(_ provider: NSItemProvider) async -> Data? {
        let data: Data? = await withCheckedContinuation { done in
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in done.resume(returning: data) }
        }
        guard let data, let image = UIImage(data: data) else { return nil }
        let side: CGFloat = 1600
        let scale = min(1, side / max(image.size.width, image.size.height))
        let size = CGSize(width: floor(image.size.width * scale), height: floor(image.size.height * scale))
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        for quality in [0.82, 0.7, 0.55, 0.4] as [CGFloat] {
            if let jpeg = resized.jpegData(compressionQuality: quality), jpeg.count <= DocumentTypes.maxImageBytes { return jpeg }
        }
        return nil
    }

    /// Cópia do arquivo no temporário da extensão (o original some quando o callback do sistema termina).
    private func copyFile(_ provider: NSItemProvider, type: String) async -> URL? {
        await withCheckedContinuation { done in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url else { return done.resume(returning: nil) }
                let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                let name = provider.suggestedName.map { name in url.pathExtension.isEmpty || name.hasSuffix(".\(url.pathExtension)") ? name : "\(name).\(url.pathExtension)" } ?? url.lastPathComponent
                let target = dir.appendingPathComponent(name)
                do {
                    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    try FileManager.default.copyItem(at: url, to: target)
                    done.resume(returning: target)
                } catch {
                    done.resume(returning: nil)
                }
            }
        }
    }

    private func loadMovie(_ provider: NSItemProvider) async -> (URL, String)? {
        guard let url = await copyFile(provider, type: UTType.movie.identifier) else { return nil }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > DocumentTypes.maxVideoBytes {
            problem = "Vídeo maior que 60 MB: envie pelo app, que reduz o vídeo antes."
            return nil
        }
        let mime = url.pathExtension.lowercased() == "mp4" ? "video/mp4" : "video/quicktime"
        return (url, mime)
    }

    private func loadDocument(_ provider: NSItemProvider) async -> Payload? {
        let type = provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .data) == true } ?? UTType.data.identifier
        guard let url = await copyFile(provider, type: type) else { return nil }
        guard let mime = DocumentTypes.byExtension[url.pathExtension.lowercased()] else { return nil }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size == 0 || size > DocumentTypes.maxFileBytes {
            problem = "Arquivo maior que 25 MB não vai pelo chat."
            return nil
        }
        return .file(url, name: url.lastPathComponent, mime: mime)
    }

    // MARK: Enviar

    func send() {
        guard let session, canSend else { return }
        phase = .sending
        problem = nil
        let picked = targets.filter { chosen.contains($0.id) }
        let text = [sharedText, caption.trimmingCharacters(in: .whitespacesAndNewlines)].filter { !$0.isEmpty }.joined(separator: "\n")
        Task {
            do {
                for (index, target) in picked.enumerated() {
                    status = picked.count > 1 ? "Enviando para \(target.title) (\(index + 1) de \(picked.count))…" : "Enviando para \(target.title)…"
                    let conversationId: String
                    if let id = target.conversationId {
                        conversationId = id
                    } else if let userId = target.userId {
                        let opened: OpenedConversation = try await post("conversations", json: ["userId": userId], session)
                        conversationId = opened.id
                    } else { continue }
                    for payload in payloads {
                        switch payload {
                        case let .image(data):
                            try await upload("conversations/\(conversationId)/media", mime: "image/jpeg", data: data, session)
                        case let .video(url, mime):
                            try await upload("conversations/\(conversationId)/media", mime: mime, file: url, session)
                        case let .file(url, name, mime):
                            try await upload("conversations/\(conversationId)/files", query: [URLQueryItem(name: "nome", value: name)], mime: mime, file: url, session)
                        }
                    }
                    if !text.isEmpty {
                        let _: EmptyReply = try await post("conversations/\(conversationId)/messages", json: ["body": text], session)
                    }
                }
                status = "Enviado"
                try? await Task.sleep(nanoseconds: 450_000_000)
                context?.completeRequest(returningItems: nil)
            } catch let failure as ApiFailure {
                phase = .ready
                status = nil
                problem = failure.message == "401" ? "Sua sessão no AskouT acabou. Abra o app e entre de novo." : failure.message
            } catch {
                phase = .ready
                status = nil
                problem = "Não deu para enviar. Confira a conexão e tente de novo."
            }
        }
    }

    // MARK: Rede

    struct EmptyReply: Decodable {}

    private func request(_ path: String, query: [URLQueryItem] = [], _ session: (token: String, base: URL)) -> URLRequest {
        var components = URLComponents(url: session.base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var req = URLRequest(url: components.url!)
        req.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 120
        return req
    }

    private func check(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw ApiFailure(message: "Sem resposta do AskouT.") }
        if http.statusCode == 401 { throw ApiFailure(message: "401") }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
            throw ApiFailure(message: message ?? "Não deu para enviar (erro \(http.statusCode)).")
        }
    }

    private func get<T: Decodable>(_ path: String, _ session: (token: String, base: URL)) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request(path, session))
        try check(response, data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ path: String, json: [String: String], _ session: (token: String, base: URL)) async throws -> T {
        var req = request(path, session)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: json)
        let (data, response) = try await URLSession.shared.data(for: req)
        try check(response, data)
        if let decoded = try? JSONDecoder().decode(T.self, from: data) { return decoded }
        return try JSONDecoder().decode(T.self, from: Data("{}".utf8))
    }

    private func upload(_ path: String, query: [URLQueryItem] = [], mime: String, data: Data? = nil, file: URL? = nil, _ session: (token: String, base: URL)) async throws {
        var req = request(path, query: query, session)
        req.httpMethod = "POST"
        req.setValue(mime, forHTTPHeaderField: "Content-Type")
        let result: (Data, URLResponse)
        if let file = file {
            result = try await URLSession.shared.upload(for: req, fromFile: file)
        } else {
            result = try await URLSession.shared.upload(for: req, from: data ?? Data())
        }
        try check(result.1, result.0)
    }

    func photoURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty, let session else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: path, relativeTo: session.base)?.absoluteURL
    }

    private func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR"))
    }
}

// MARK: - Tela

private let brand = Color(red: 0.98, green: 0.45, blue: 0.79)

struct ShareRootView: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        NavigationView {
            content
                .navigationTitle("Enviar para…")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancelar") { model.cancel() }.disabled(model.phase == .sending)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Enviar") { model.send() }.disabled(!model.canSend).font(.body.weight(.semibold))
                    }
                }
        }
        .navigationViewStyle(.stack)
        .tint(brand)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .needsLogin:
            VStack(spacing: 12) {
                Image(systemName: "person.crop.circle.badge.exclamationmark").font(.system(size: 44)).foregroundColor(brand)
                Text("Entre no AskouT").font(.headline)
                Text("Abra o app do AskouT e entre na sua conta. Depois é só compartilhar de novo.")
                    .multilineTextAlignment(.center).foregroundColor(.secondary).padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready, .sending:
            list
        }
    }

    private var list: some View {
        List {
            Section {
                if !model.summary.isEmpty {
                    Label(model.summary, systemImage: "paperclip").foregroundColor(.secondary)
                }
                if model.skipped > 0 {
                    Text(model.skipped == 1 ? "1 item não pode ir pelo chat e ficou de fora." : "\(model.skipped) itens não podem ir pelo chat e ficaram de fora.")
                        .font(.footnote).foregroundColor(.secondary)
                }
                TextField("Escreva uma mensagem (opcional)", text: $model.caption)
            }
            if let problem = model.problem {
                Section { Text(problem).foregroundColor(.red).font(.footnote) }
            }
            if let status = model.status {
                Section {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text(status).font(.footnote)
                    }
                }
            }
            Section(header: Text(model.chosen.isEmpty ? "Conversas e amigos" : (model.chosen.count == 1 ? "1 escolhido" : "\(model.chosen.count) escolhidos"))) {
                if model.targets.isEmpty {
                    Text("Quando você tiver amigos ou conversas, eles aparecem aqui.").foregroundColor(.secondary)
                }
                ForEach(model.shown) { target in
                    Button {
                        model.toggle(target)
                    } label: {
                        HStack(spacing: 12) {
                            Avatar(url: model.photoURL(target.photo), title: target.title)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(target.title).foregroundColor(.primary).lineLimit(1)
                                Text(target.subtitle).font(.footnote).foregroundColor(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Image(systemName: model.chosen.contains(target.id) ? "checkmark.circle.fill" : "circle")
                                .font(.title3)
                                .foregroundColor(model.chosen.contains(target.id) ? brand : Color(.tertiaryLabel))
                        }
                    }
                    .disabled(model.phase == .sending)
                }
            }
        }
        .searchable(text: $model.query, prompt: "Buscar conversa ou amigo")
    }
}

struct Avatar: View {
    let url: URL?
    let title: String

    var body: some View {
        ZStack {
            Circle().fill(brand.opacity(0.18))
            Text(String(title.prefix(1)).uppercased()).font(.headline).foregroundColor(brand)
            if let url {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
                .clipShape(Circle())
            }
        }
        .frame(width: 40, height: 40)
    }
}
