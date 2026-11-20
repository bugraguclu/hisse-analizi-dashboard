import SwiftUI
import UIKit
import WidgetKit

@main
struct HisseAnaliziApp: App {
    @StateObject private var model = ConnectionModel()
    @StateObject private var reminders = CalendarReminderManager()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model, reminders: reminders)
                .onAppear {
                    reminders.attachDeepLinkHandler { url in
                        model.open(url)
                    }
                }
                .onOpenURL { url in
                    model.open(url)
                }
                .onContinueUserActivity(HisseShortcutActivity.activityType) { activity in
                    if let url = HisseShortcutActivity.extractURL(from: activity) {
                        model.open(url)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: ShortcutRouteBridge.notificationName)) { note in
                    if let url = note.userInfo?[ShortcutRouteBridge.urlUserInfoKey] as? URL {
                        model.open(url)
                    }
                }
                .task(id: model.snapshot?.upcomingEvents) {
                    await reminders.sync(events: model.snapshot?.upcomingEvents ?? [])
                }
        }
    }
}

enum AppTab: Hashable {
    case overview
    case reminders
    case shortcuts
    case connection
}

@MainActor
final class ConnectionModel: ObservableObject {
    static let defaultServer = "https://hisse-analizi.duckdns.org"

    @Published private(set) var pairing = ConnectionStore.pairing
    @Published private(set) var snapshot = ConnectionStore.snapshot
    @Published private(set) var isOffline = false
    @Published private(set) var busy = false

    @Published var server = ConnectionStore.pairing?.server.absoluteString ?? ConnectionModel.defaultServer
    @Published var code = ""
    @Published var message: String?

    @Published var selectedTab: AppTab = .overview
    @Published var focusedTicker: String?
    @Published var focusedEvent: CalendarEventItem?
    @Published var routeBanner: String?

    private var duplicateGuard = DuplicateRouteGuard()

    var removed: Bool { ConnectionStore.removed }

    /// Handles `hisseanalizi://` URLs from QR codes, WidgetKit taps, local reminders, and Siri Shortcuts.
    ///
    /// QR pairing links auto-pair ONLY with the default or already-paired server origin. Any other
    /// server waits in the form for the user to verify, so an untrusted QR code cannot redirect the widget.
    func open(_ url: URL) {
        guard duplicateGuard.shouldProcess(url.absoluteString) else { return }
        guard let route = DeepLinkRouter.parse(url) else { return }

        switch route {
        case .pair(let serverArg, let codeArg):
            selectedTab = .connection
            let address = serverArg ?? server
            guard TrustedOriginChecker.isTrusted(
                address: address,
                defaultServer: Self.defaultServer,
                pairedServer: pairing?.server.absoluteString
            ) else {
                let host = URL(string: address)?.host ?? address
                if pairing == nil {
                    server = address
                    code = codeArg
                    message = "Bu bağlantı başka bir sunucuya ait: \(host). Adres doğruysa Bağla'ya dokun."
                } else {
                    message = "Bu bağlantı başka bir sunucuya ait (\(host)); mevcut bağlantın değişmedi."
                }
                return
            }
            server = address
            code = codeArg
            Task { await pair() }

        case .market:
            selectedTab = .overview
            routeBanner = nil
            Task { await refresh() }

        case .dashboard(let id):
            selectedTab = .overview
            if let current = snapshot?.dashboardId, !current.isEmpty, current != id, id != "home" {
                routeBanner = "“\(id)” panosu bulunamadı; ana piyasa özeti açıldı."
            } else {
                routeBanner = nil
            }
            Task { await refresh() }

        case .watchlist(let id):
            selectedTab = .overview
            if let currentId = snapshot?.watchlist.id, currentId != id, id != "favorites" {
                routeBanner = "Kestirmedeki takip listesi (\(id)) kaldırılmış veya değiştirilmiş. Mevcut bağlı liste “\(snapshot?.watchlist.name ?? "Favoriler")” gösteriliyor."
            } else {
                routeBanner = nil
            }
            Task { await refresh() }

        case .stock(let ticker, _):
            selectedTab = .overview
            routeBanner = nil
            focusedTicker = ticker
            Task { await refresh() }

        case .event(let id):
            selectedTab = .reminders
            if let found = snapshot?.upcomingEvents.first(where: { $0.id == id }) {
                focusedEvent = found
                routeBanner = nil
            } else {
                routeBanner = "İlgili takvim olayı artık güncel listede bulunmuyor veya tarihi geçti."
            }
            Task { await refresh() }

        case .unknown:
            selectedTab = .overview
            routeBanner = "Bağlantı tanınmadı; ana piyasa özeti açıldı."
        }
    }

    func pair() async {
        guard !busy else { return }
        let address = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: address),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil else {
            message = "Sunucu adresi geçersiz."
            return
        }
        let cleaned = code.uppercased().filter { $0.isLetter || $0.isNumber }
        guard cleaned.count == 8 else {
            message = "Kod 8 karakter olmalı."
            return
        }

        busy = true
        message = nil
        defer { busy = false }

        do {
            let deviceName = UIDevice.current.name.isEmpty ? UIDevice.current.model : UIDevice.current.name
            let paired = try await WidgetAPI.pair(server: url, code: cleaned, name: deviceName)
            ConnectionStore.pairing = paired
            self.pairing = paired
            code = ""
            await refresh()
            selectedTab = .overview
        } catch {
            message = error.localizedDescription
        }
    }

    func refresh() async {
        guard let pairing else { return }
        do {
            let fresh = try await WidgetAPI.summary(for: pairing)
            ConnectionStore.snapshot = fresh
            snapshot = fresh
            isOffline = false
            message = nil
        } catch WidgetAPIError.unpaired {
            ConnectionStore.forget(removedByServer: true)
            self.pairing = nil
            snapshot = nil
            isOffline = false
            message = nil
            selectedTab = .connection
        } catch {
            isOffline = true
            message = error.localizedDescription
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    func unpair() async {
        guard let pairing else { return }
        await WidgetAPI.unpair(pairing)
        ConnectionStore.forget(removedByServer: false)
        self.pairing = nil
        snapshot = nil
        isOffline = false
        message = nil
        WidgetCenter.shared.reloadAllTimelines()
    }

    func webURL(path: String) -> URL? {
        guard let pairing else { return nil }
        var base = pairing.server.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        let suffix = path.hasPrefix("/") ? path : "/\(path)"
        return URL(string: "\(base)\(suffix)")
    }
}
