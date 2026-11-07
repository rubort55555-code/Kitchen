import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = KitchenViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Экран приложения: Capacitor плюс свой модуль яркости.
class KitchenViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(BrightnessPlugin())
    }
}

/// Яркость экрана для оформления «по яркости»: положение ползунка яркости, 0…1.
/// С автояркостью ползунок сам следует за освещением.
@objc(BrightnessPlugin)
public class BrightnessPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BrightnessPlugin"
    public let jsName = "Brightness"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise)
    ]

    @objc func get(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let screen = self.bridge?.viewController?.view.window?.windowScene?.screen ?? UIScreen.main
            call.resolve(["value": Double(screen.brightness)])
        }
    }
}
