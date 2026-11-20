import AppIntents
import Intents
import IntentsUI
import SwiftUI
import UIKit

// MARK: - NSUserActivity & Voice Shortcut Donation (adapted from TusAnkiM's DeckShortcutsModule.swift)

enum HisseShortcutActivity {
    static let activityType = "com.bugraguclu.hisseanalizi.shortcut"
    static let urlKey = "targetURL"

    static func makeActivity(shortcutId: String, title: String, phrase: String, route: AppRoute) -> NSUserActivity {
        let targetURL = DeepLinkRouter.url(for: route).absoluteString
        let activity = NSUserActivity(activityType: activityType)
        activity.title = title
        activity.userInfo = [urlKey: targetURL]
        activity.requiredUserInfoKeys = Set([urlKey])
        activity.isEligibleForSearch = true
        activity.isEligibleForPrediction = true
        activity.persistentIdentifier = "com.bugraguclu.hisseanalizi.shortcut.\(shortcutId)"
        activity.suggestedInvocationPhrase = phrase
        activity.becomeCurrent()
        return activity
    }

    static func extractURL(from userActivity: NSUserActivity) -> URL? {
        guard userActivity.activityType == activityType,
              let urlString = userActivity.userInfo?[urlKey] as? String else {
            return nil
        }
        return URL(string: urlString)
    }
}

struct ShortcutDefinition: Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String
    let phrase: String
    let route: AppRoute
    let systemImage: String

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

/// SwiftUI wrapper around `INUIAddVoiceShortcutViewController` so users can add any stock,
/// watchlist, or personal dashboard to Siri in one tap.
struct AddToSiriSheet: UIViewControllerRepresentable {
    let shortcut: ShortcutDefinition
    let onFinish: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    func makeUIViewController(context: Context) -> UIViewController {
        let activity = HisseShortcutActivity.makeActivity(
            shortcutId: shortcut.id,
            title: shortcut.title,
            phrase: shortcut.phrase,
            route: shortcut.route
        )
        let inShortcut = INShortcut(userActivity: activity)
        let controller = INUIAddVoiceShortcutViewController(shortcut: inShortcut)
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}

    final class Coordinator: NSObject, INUIAddVoiceShortcutViewControllerDelegate {
        private let onFinish: (String) -> Void
        private var finished = false

        init(onFinish: @escaping (String) -> Void) {
            self.onFinish = onFinish
        }

        private func complete(_ status: String) {
            guard !finished else { return }
            finished = true
            onFinish(status)
        }

        func addVoiceShortcutViewController(
            _ controller: INUIAddVoiceShortcutViewController,
            didFinishWith voiceShortcut: INVoiceShortcut?,
            error: Error?
        ) {
            controller.dismiss(animated: true) {
                self.complete(error == nil && voiceShortcut != nil ? "created" : "unsupported")
            }
        }

        func addVoiceShortcutViewControllerDidCancel(_ controller: INUIAddVoiceShortcutViewController) {
            controller.dismiss(animated: true) {
                self.complete("cancelled")
            }
        }
    }
}

// MARK: - App Intents (iOS 17+ Siri & Apple Shortcuts Integration)

enum ShortcutRouteBridge {
    static let notificationName = Notification.Name("HisseAnaliziOpenShortcutRoute")
    static let urlUserInfoKey = "url"

    static func dispatch(_ route: AppRoute) {
        let url = DeepLinkRouter.url(for: route)
        Task { @MainActor in
            NotificationCenter.default.post(
                name: notificationName,
                object: nil,
                userInfo: [urlUserInfoKey: url]
            )
        }
    }
}

struct OpenStockIntent: AppIntent {
    static var title: LocalizedStringResource = "Hisse Analizini Aç"
    static var description = IntentDescription("Belirli bir BIST hissesinin analiz özetini açar.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Hisse Kodu", default: "THYAO")
    var ticker: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let normalized = DeepLinkRouter.normalizeTicker(ticker) ?? "THYAO"
        ShortcutRouteBridge.dispatch(.stock(ticker: normalized, tab: nil))
        return .result(dialog: "\(normalized) hisse analizi açılıyor.")
    }
}

struct OpenWatchlistIntent: AppIntent {
    static var title: LocalizedStringResource = "Takip Listemi Aç"
    static var description = IntentDescription("Kayıtlı BIST takip listenizi açar.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Liste Kimliği", default: "favorites")
    var watchlistId: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let targetId = watchlistId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "favorites" : watchlistId
        ShortcutRouteBridge.dispatch(.watchlist(id: targetId))
        return .result(dialog: "Takip listeniz açılıyor.")
    }
}

struct OpenDashboardIntent: AppIntent {
    static var title: LocalizedStringResource = "Sabah Panomu Aç"
    static var description = IntentDescription("BIST 100 özeti, takip listesi ve yaklaşan olayların bulunduğu kişisel panoyu açar.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Pano Kimliği", default: "home")
    var dashboardId: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let targetId = dashboardId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "home" : dashboardId
        ShortcutRouteBridge.dispatch(.dashboard(id: targetId))
        return .result(dialog: "Sabah panonuz açılıyor.")
    }
}

struct HisseAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenDashboardIntent(),
            phrases: [
                "\(.applicationName) sabah panomu aç",
                "\(.applicationName) piyasa özetini aç",
                "Open morning dashboard in \(.applicationName)",
            ],
            shortTitle: "Sabah Panom",
            systemImageName: "chart.line.uptrend.xyaxis"
        )
        AppShortcut(
            intent: OpenWatchlistIntent(),
            phrases: [
                "\(.applicationName) takip listemi aç",
                "Open my watchlist in \(.applicationName)",
            ],
            shortTitle: "Takip Listem",
            systemImageName: "star.fill"
        )
        AppShortcut(
            intent: OpenStockIntent(),
            phrases: [
                "\(.applicationName) ile hisse analizini aç",
                "Open stock analysis in \(.applicationName)",
            ],
            shortTitle: "Hisse Analizi",
            systemImageName: "magnifyingglass"
        )
    }
}
