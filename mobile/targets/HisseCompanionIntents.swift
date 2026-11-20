import AppIntents
import Foundation

/// Persist before opening the app so cold launch and warm launch share the same delivery path.
private enum ShortcutDestination {
    static func open(_ path: String) {
        let group = Bundle.main.object(forInfoDictionaryKey: "HisseAppGroup") as? String ?? "group.com.hisseanalizi.app"
        UserDefaults(suiteName: group)?.set("hisseanalizi://\(path)", forKey: "pendingShortcutURL")
        NotificationCenter.default.post(name: Notification.Name("HisseCompanionShortcut"), object: nil)
    }
}

struct OpenMorningDashboardIntent: AppIntent {
    static var title: LocalizedStringResource = "Sabah Panomu Aç"
    static var openAppWhenRun: Bool = true
    @MainActor func perform() async throws -> some IntentResult {
        ShortcutDestination.open("market")
        return .result()
    }
}

struct OpenWatchlistIntent: AppIntent {
    static var title: LocalizedStringResource = "Takip Listemi Aç"
    static var openAppWhenRun: Bool = true
    @MainActor func perform() async throws -> some IntentResult {
        ShortcutDestination.open("watchlist")
        return .result()
    }
}

struct OpenStockIntent: AppIntent {
    static var title: LocalizedStringResource = "Hisse Analizini Aç"
    static var openAppWhenRun: Bool = true
    @Parameter(title: "Hisse Kodu", default: "THYAO") var ticker: String
    @MainActor func perform() async throws -> some IntentResult {
        let clean = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard clean.range(of: "^[A-Z0-9]{2,10}$", options: .regularExpression) != nil else {
            throw NSError(domain: "HisseShortcut", code: 1, userInfo: [NSLocalizedDescriptionKey: "Geçersiz hisse kodu"])
        }
        ShortcutDestination.open("stock/\(clean)")
        return .result()
    }
}

struct HisseAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenMorningDashboardIntent(), phrases: ["\(.applicationName) sabah panomu aç"], shortTitle: "Sabah Panom", systemImageName: "chart.line.uptrend.xyaxis")
        AppShortcut(intent: OpenWatchlistIntent(), phrases: ["\(.applicationName) takip listemi aç"], shortTitle: "Takip Listem", systemImageName: "star.fill")
        AppShortcut(intent: OpenStockIntent(), phrases: ["\(.applicationName) hisse analizini aç"], shortTitle: "Hisse Analizi", systemImageName: "magnifyingglass")
    }
}
