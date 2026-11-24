import UIKit
import Capacitor
import ObjectiveC
import UserNotifications

/// Tira a barra extra do teclado do iPhone (setas para cima/baixo e "OK") que o WebView mostra sobre o teclado.
/// Faz o campo de texto do WebView não oferecer `inputAccessoryView`. Só afeta o app, não o teclado em si.
private func hideKeyboardAccessoryBar() {
    guard let contentView = NSClassFromString("WKContentView") else { return }
    let block: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
    class_replaceMethod(contentView, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(block), "@@:")
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        hideKeyboardAccessoryBar()
        // "Responder" nas notificações de mensagem: registra a categoria e assume as respostas desde já, porque o
        // iPhone pode abrir o app em segundo plano só para entregar a resposta, sem tela e sem o Capacitor.
        NotificationReply.shared.registerCategories()
        NotificationReply.shared.install()
        // Chegada ao vivo do NOW na tela bloqueada (Live Activity): token "push-to-start" e registro das atividades.
        ArrivalActivities.shared.start()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // Avisos (push) no iPhone: repassa o token do aparelho ao plugin de notificações do Capacitor.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}


/// Tela principal: reforça a retirada da barra do teclado (setas e OK) direto no WebView que está na tela
/// e tira o "efeito mola" da página (ver `disableBounce`).
class MainViewController: CAPBridgeViewController {
    /// Plugins nativos do próprio app (fora do npm): a galeria dentro do app para criar stories e o player das mensagens de voz.
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GalleryPlugin())
        // O Capacitor acabou de se colocar como quem recebe as notificações: volta para o "Responder", que repassa
        // a ele tudo o que não é resposta (toque no aviso, aviso com o app aberto).
        if let router = bridge?.notificationRouter { NotificationReply.shared.attach(router: router) }
        // Mensagens de voz tocadas pelo iPhone, fora do "Tocando agora" (ver AudioPlugin.swift).
        bridge?.registerPluginInstance(AudioPlugin())
        // Sessão para a folha "Compartilhar com o AskouT" (Share Extension), no Keychain compartilhado.
        bridge?.registerPluginInstance(ShareSessionPlugin())
        // Token da Live Activity da chegada ao vivo (ver ArrivalActivities.swift).
        bridge?.registerPluginInstance(LiveActivityPlugin())
        // Widgets da tela inicial e da tela bloqueada: recarregar quando algo muda no app (ver WidgetsPlugin.swift).
        bridge?.registerPluginInstance(WidgetsPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        hideAccessory()
        disableBounce()
        // Empurrar a tela da borda esquerda para a direita volta à tela anterior (o app web usa o histórico do navegador).
        self.webView?.allowsBackForwardNavigationGestures = true
    }

    /// Sem a mola do iOS, a página não passa do fim: no chat o campo de mensagem não se solta do rodapé nem mostra
    /// um vão embaixo dele. O CSS (`overscroll-behavior-y: none`) só vale do iOS 16 em diante; aqui vale em todos.
    /// O puxar-para-atualizar do app é feito em JavaScript (toques), então continua funcionando.
    private func disableBounce() {
        guard let scroll = self.webView?.scrollView else { return }
        scroll.bounces = false
        scroll.alwaysBounceVertical = false
        scroll.alwaysBounceHorizontal = false
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        hideAccessory()
    }

    private func hideAccessory() {
        guard let web = self.webView else { return }
        web.inputAssistantItem.leadingBarButtonGroups = []
        web.inputAssistantItem.trailingBarButtonGroups = []
        let block: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
        let imp = imp_implementationWithBlock(block)
        for view in web.scrollView.subviews where String(describing: type(of: view)).hasPrefix("WKContent") {
            class_replaceMethod(type(of: view), #selector(getter: UIResponder.inputAccessoryView), imp, "@@:")
        }
    }
}

/// "Responder" direto na notificação de mensagem, sem abrir o app.
///
/// O servidor manda o push com `aps.category = "MESSAGE"` e um token `reply`, que só vale para aquela conversa
/// neste aparelho (apps/api, NotificationService.replier). A resposta vai para `<API>/notifications/push/reply`;
/// o endereço da API vem de `public/askout-native.json`, gerado no build (apps/mobile/scripts/build-web.mjs).
///
/// O iPhone só tem um "delegate" de notificações. O do Capacitor (NotificationRouter) cuida do toque no aviso e do
/// aviso com o app aberto; este fica na frente, trata só a resposta e repassa o resto. Toques que chegam antes de o
/// Capacitor carregar ficam guardados até ele chegar.
final class NotificationReply: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationReply()
    static let categoryId = "MESSAGE"
    static let actionId = "REPLY"

    private weak var router: NotificationRouter?
    private var waiting: [(UNNotificationResponse, () -> Void)] = []

    func registerCategories() {
        let reply = UNTextInputNotificationAction(identifier: Self.actionId, title: "Responder", options: [], textInputButtonTitle: "Enviar", textInputPlaceholder: "Mensagem")
        let category = UNNotificationCategory(identifier: Self.categoryId, actions: [reply], intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    func install() {
        UNUserNotificationCenter.current().delegate = self
    }

    func attach(router: NotificationRouter) {
        self.router = router
        install()
        let queued = waiting
        waiting = []
        for (response, done) in queued {
            router.userNotificationCenter(UNUserNotificationCenter.current(), didReceive: response, withCompletionHandler: done)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if let router = router {
            router.userNotificationCenter(center, willPresent: notification, withCompletionHandler: completionHandler)
        } else {
            completionHandler([])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == Self.actionId, let text = (response as? UNTextInputNotificationResponse)?.userText {
            send(text, from: response.notification, done: completionHandler)
            return
        }
        if let router = router {
            router.userNotificationCenter(center, didReceive: response, withCompletionHandler: completionHandler)
        } else {
            waiting.append((response, completionHandler))
        }
    }

    private func apiURL() -> URL? {
        guard let file = Bundle.main.url(forResource: "askout-native", withExtension: "json", subdirectory: "public"),
              let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let base = json["apiUrl"] as? String, base.hasPrefix("https://") else { return nil }
        return URL(string: base + "/notifications/push/reply")
    }

    private func send(_ text: String, from notification: UNNotification, done: @escaping () -> Void) {
        let info = notification.request.content.userInfo
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { done(); return }
        guard let token = info["reply"] as? String, let url = apiURL() else {
            failed(info: info)
            done()
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "body": body])

        // Com o app fechado, o iPhone dá alguns segundos em segundo plano: segura até a resposta sair.
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        URLSession.shared.dataTask(with: request) { _, response, error in
            let ok = error == nil && ((response as? HTTPURLResponse)?.statusCode ?? 0) / 100 == 2
            DispatchQueue.main.async {
                if !ok { self.failed(info: info) }
                done()
                if task != .invalid {
                    UIApplication.shared.endBackgroundTask(task)
                    task = .invalid
                }
            }
        }.resume()
    }

    /// Não foi: avisa, e tocar no aviso abre a conversa (o mesmo `url` do push original).
    private func failed(info: [AnyHashable: Any]) {
        let content = UNMutableNotificationContent()
        content.title = "Sua resposta não foi enviada"
        content.body = "Toque para abrir a conversa e tentar de novo."
        content.sound = .default
        if let path = info["url"] as? String { content.userInfo = ["url": path] }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "reply-failed-" + UUID().uuidString, content: content, trigger: nil))
    }
}
