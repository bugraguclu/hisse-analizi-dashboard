import Foundation
import UserNotifications

enum NotificationPermissionState: String, Equatable, Sendable {
    case granted
    case provisional
    case limited
    case denied
    case undetermined

    var allowsDelivery: Bool {
        self == .granted || self == .provisional || self == .limited
    }

    var labelTR: String {
        switch self {
        case .granted: return "Bildirim izni açık"
        case .provisional: return "Sessiz teslim açık"
        case .limited: return "Sınırlı izin"
        case .denied: return "Bildirim izni kapalı (Ayarlar'dan açın)"
        case .undetermined: return "İzin henüz istenmedi"
        }
    }
}

/// Manages local calendar reminders for earnings, dividends, and economic releases via `UNUserNotificationCenter`.
///
/// Adapted from TusAnkiM's `studyNotifications.ts`:
/// - Serializes async operations so rapid toggles never interleave.
/// - Cancels/reschedules only notifications tagged with `CalendarReminderPlanner.ownedKind`.
/// - Routes notification taps (both cold launch and active app) to the target stock or event.
@MainActor
final class CalendarReminderManager: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @Published private(set) var permissionState: NotificationPermissionState = .undetermined
    @Published private(set) var scheduledCount: Int = 0
    @Published var preferences: CalendarReminderPreferences {
        didSet {
            ConnectionStore.reminderPreferences = preferences
        }
    }

    var onOpenDeepLink: ((URL) -> Void)?
    private var pendingTapURL: URL?
    private var syncTask: Task<Void, Never>?

    override init() {
        self.preferences = ConnectionStore.reminderPreferences
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func attachDeepLinkHandler(_ handler: @escaping (URL) -> Void) {
        onOpenDeepLink = handler
        if let pending = pendingTapURL {
            pendingTapURL = nil
            handler(pending)
        }
    }

    func refreshPermissionStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        permissionState = Self.mapStatus(settings)
    }

    func requestPermission() async -> NotificationPermissionState {
        let center = UNUserNotificationCenter.current()
        let current = await center.notificationSettings()
        if current.authorizationStatus == .denied {
            permissionState = .denied
            return .denied
        }
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
        await refreshPermissionStatus()
        return permissionState
    }

    func sync(events: [CalendarEventItem]) async {
        // Serialize concurrent sync requests so old cancellations and new schedules never race.
        let previous = syncTask
        let task = Task { @MainActor in
            await previous?.value
            await self.performSync(events: events)
        }
        syncTask = task
        await task.value
    }

    func disableAll() async {
        preferences.enabled = false
        await sync(events: [])
    }

    private func performSync(events: [CalendarEventItem]) async {
        let center = UNUserNotificationCenter.current()
        await refreshPermissionStatus()

        let pending = await center.pendingNotificationRequests()
        var existingOwned: [String: Date] = [:]
        for request in pending where Self.isOwned(request.content.userInfo) {
            if let trigger = request.trigger as? UNCalendarNotificationTrigger,
               let nextDate = trigger.nextTriggerDate() {
                existingOwned[request.identifier] = nextDate
            } else {
                existingOwned[request.identifier] = .distantPast
            }
        }

        guard preferences.enabled, permissionState.allowsDelivery else {
            if !existingOwned.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: Array(existingOwned.keys))
            }
            scheduledCount = 0
            return
        }

        let desired = CalendarReminderPlanner.plan(events: events, preferences: preferences)
        let diff = CalendarReminderPlanner.reconcile(existing: existingOwned, desired: desired)

        if !diff.toCancel.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: diff.toCancel)
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = MarketFormat.istanbulTimeZone

        for item in diff.toSchedule {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            content.userInfo = [
                "kind": CalendarReminderPlanner.ownedKind,
                "eventId": item.eventId,
                "eventKind": item.eventKind.rawValue,
                "deepLink": item.deepLink,
                "ticker": item.ticker ?? "",
            ]
            let comps = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: item.fireDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            let request = UNNotificationRequest(identifier: item.identifier, content: content, trigger: trigger)
            try? await center.add(request)
        }

        scheduledCount = desired.count
    }

    private static func isOwned(_ userInfo: [AnyHashable: Any]) -> Bool {
        (userInfo["kind"] as? String) == CalendarReminderPlanner.ownedKind
    }

    private static func mapStatus(_ settings: UNNotificationSettings) -> NotificationPermissionState {
        switch settings.authorizationStatus {
        case .authorized:
            return settings.alertSetting == .disabled ? .limited : .granted
        case .provisional:
            return .provisional
        case .ephemeral:
            return .limited
        case .denied:
            return .denied
        case .notDetermined:
            return .undetermined
        @unknown default:
            return .undetermined
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        guard let rawLink = userInfo["deepLink"] as? String,
              let url = URL(string: rawLink) else {
            return
        }
        await MainActor.run {
            if let handler = self.onOpenDeepLink {
                handler(url)
            } else {
                self.pendingTapURL = url
            }
        }
    }
}
