import Capacitor
import Foundation
import UIKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Live Activity da chegada ao vivo do NOW, do lado do app (o desenho fica na extensão ArrivalWidget).
///
/// Quem abre, atualiza e fecha a atividade é o servidor, por push. O app só faz duas coisas:
/// 1. guarda o token "push-to-start" do iPhone (iOS 17.2+), que o app web manda ao servidor como `apnsls:<token>`
///    (ponte `window.AskouTPush.liveActivityToken`, ver apps/web/src/lib/push.ts);
/// 2. quando o servidor abre uma atividade, manda o token dela para `<API>/notifications/push/live-activity`, com o
///    `registration` assinado que veio dentro da atividade (sem login: o iPhone pode abrir o app em segundo plano só
///    para isso). Depois disso as atualizações vão direto para a atividade;
/// 3. quando a pessoa fecha a atividade, avisa `<API>/notifications/push/live-activity/closed`: o servidor abre outra
///    na próxima posição do amigo. Ao voltar ao NOW, o app web pergunta se ela está na tela (`isShowing`) e, se não,
///    pede ao servidor para abrir de novo na hora.
final class ArrivalActivities {
    static let shared = ArrivalActivities()

    private let queue = DispatchQueue(label: "br.com.askout.arrival-activities")
    private var watching = Set<String>()
    private var startToken: String?
    private var waiters: [(String?) -> Void] = []

    /// Chamado ao abrir o app (inclusive quando o iPhone abre em segundo plano para entregar o token da atividade).
    func start() {
        #if canImport(ActivityKit)
        // `.dismissed` (a pessoa fechou) existe do iOS 16.2 em diante; abrir por push só do 17.2.
        guard #available(iOS 16.2, *) else { return }
        for activity in Activity<ArrivalAttributes>.activities { watch(activity) }
        Task {
            for await activity in Activity<ArrivalAttributes>.activityUpdates { self.watch(activity) }
        }
        if #available(iOS 17.2, *) {
            if let data = Activity<ArrivalAttributes>.pushToStartToken { setStartToken(Self.hex(data)) }
            Task {
                for await data in Activity<ArrivalAttributes>.pushToStartTokenUpdates { self.setStartToken(Self.hex(data)) }
            }
        }
        #endif
    }

    /// Token "push-to-start" (hexadecimal), esperando até `timeout` se o iPhone ainda não entregou. `nil` em iPhone
    /// sem suporte (antes do iOS 17.2) ou com as Atividades ao Vivo desligadas para o AskouT.
    func currentStartToken(timeout: TimeInterval, done: @escaping (String?) -> Void) {
        #if canImport(ActivityKit)
        guard #available(iOS 17.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else { done(nil); return }
        queue.async {
            if let token = self.startToken { done(token); return }
            self.waiters.append(done)
            self.queue.asyncAfter(deadline: .now() + timeout) {
                guard !self.waiters.isEmpty else { return }
                let pending = self.waiters
                self.waiters = []
                pending.forEach { $0(nil) }
            }
        }
        #else
        done(nil)
        #endif
    }

    private func setStartToken(_ token: String) {
        queue.async {
            self.startToken = token
            let pending = self.waiters
            self.waiters = []
            pending.forEach { $0(token) }
        }
    }

    /// A chegada `tag` está na tela agora (tela bloqueada / Dynamic Island)? `nil` onde não há Live Activity.
    func isShowing(tag: String) -> Bool? {
        #if canImport(ActivityKit)
        guard #available(iOS 17.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
        return Activity<ArrivalAttributes>.activities.contains { $0.attributes.tag == tag && $0.activityState == .active }
        #else
        return nil
        #endif
    }

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    private func watch(_ activity: Activity<ArrivalAttributes>) {
        let first: Bool = queue.sync { self.watching.insert(activity.id).inserted }
        guard first else { return }
        let registration = activity.attributes.registration
        // Fechada antes de o app abrir (o iPhone ainda lista por um tempo): avisa o servidor.
        if activity.activityState == .dismissed {
            closed(registration: registration, token: activity.pushToken.map(Self.hex))
            return
        }
        Task {
            for await data in activity.pushTokenUpdates {
                self.post(path: "/notifications/push/live-activity", body: ["registration": registration, "token": Self.hex(data)])
            }
        }
        // A pessoa fechou (arrastou para o lado; o iPhone não deixa impedir): o servidor para de mandar para ela e
        // abre outra na próxima posição do amigo, ou na hora quando a pessoa volta ao NOW no app.
        Task {
            for await state in activity.activityStateUpdates where state == .dismissed {
                self.closed(registration: registration, token: activity.pushToken.map(Self.hex))
                break
            }
        }
    }
    #endif

    private func closed(registration: String, token: String?) {
        var body: [String: Any] = ["registration": registration]
        if let token = token { body["token"] = token }
        post(path: "/notifications/push/live-activity/closed", body: body)
    }

    private func post(path: String, body: [String: Any]) {
        guard let url = Self.apiURL(path: path) else { return }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        // Com o app em segundo plano, o iPhone dá alguns segundos: segura até o registro sair.
        DispatchQueue.main.async {
            var task: UIBackgroundTaskIdentifier = .invalid
            task = UIApplication.shared.beginBackgroundTask {
                UIApplication.shared.endBackgroundTask(task)
                task = .invalid
            }
            URLSession.shared.dataTask(with: request) { _, _, _ in
                DispatchQueue.main.async {
                    if task != .invalid {
                        UIApplication.shared.endBackgroundTask(task)
                        task = .invalid
                    }
                }
            }.resume()
        }
    }

    /// Endereço da API de `public/askout-native.json` (gerado no build, como no "Responder" das notificações).
    private static func apiURL(path: String) -> URL? {
        guard let file = Bundle.main.url(forResource: "askout-native", withExtension: "json", subdirectory: "public"),
              let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let base = json["apiUrl"] as? String, base.hasPrefix("https://") else { return nil }
        return URL(string: base + path)
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

/// Ponte para o app web: `AskouTLiveActivity.startToken()` devolve o token "push-to-start" (ou nada).
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "AskouTLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isShowing", returnType: CAPPluginReturnPromise),
    ]

    /// `{ tag }` → `{ showing?: boolean }` (sem `showing` onde não há Live Activity).
    @objc func isShowing(_ call: CAPPluginCall) {
        guard let tag = call.getString("tag"), !tag.isEmpty else { call.reject("tag"); return }
        if let showing = ArrivalActivities.shared.isShowing(tag: tag) {
            call.resolve(["showing": showing])
        } else {
            call.resolve([:])
        }
    }

    @objc func startToken(_ call: CAPPluginCall) {
        ArrivalActivities.shared.currentStartToken(timeout: 5) { token in
            if let token = token {
                call.resolve(["token": token])
            } else {
                call.resolve([:])
            }
        }
    }
}
