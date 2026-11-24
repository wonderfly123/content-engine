import SwiftUI

/// Wakes the app when background uploads finish while it was suspended.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        PartTransfer.shared.backgroundCompletion = completionHandler
    }
}

@main
struct NekterApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var uploader = Uploader()
    @StateObject private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(uploader)
                .environmentObject(auth)
                // nekter://u/<token>, or the texted https link opened in the app.
                // The sign-in sheet handles nekter://auth itself; anything else here is an upload link.
                .onOpenURL { if $0.host != "auth" { uploader.useLink($0.absoluteString) } }
        }
    }
}
