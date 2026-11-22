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
/// Expo Notifications owns notification delivery and tap routing; this class only schedules.
@MainActor
final class CalendarReminderManager: NSObject {
    private(set) var permissionState: NotificationPermissionState = .undetermined
    private(set) var scheduledCount: Int = 0
    var preferences: CalendarReminderPreferences {
        didSet {
            ConnectionStore.reminderPreferences = preferences
        }
    }

    private var syncTask: Task<Void, Never>?

    override init() {
        self.preferences = ConnectionStore.reminderPreferences
        super.init()
    }

    func refreshPermissionStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        permissionState = Self.mapStatus(settings)
        scheduledCount = await UNUserNotificationCenter.current().pendingNotificationRequests()
            .filter { Self.isOwned($0.content.userInfo) }.count
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
        var existingContent: [String: String] = [:]
        for request in pending where Self.isOwned(request.content.userInfo) {
            if let fingerprint = request.content.userInfo["fingerprint"] as? String {
                existingContent[request.identifier] = fingerprint
            }
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
        let diff = CalendarReminderPlanner.reconcile(
            existing: existingOwned,
            desired: desired,
            existingContent: existingContent
        )

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
                "deepLink": item.notificationDeepLink,
                "ticker": item.ticker ?? "",
                "fingerprint": item.contentFingerprint,
            ]
            var comps = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: item.fireDate)
            comps.timeZone = MarketFormat.istanbulTimeZone
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            let request = UNNotificationRequest(identifier: item.identifier, content: content, trigger: trigger)
            try? await center.add(request)
        }

        let scheduled = await center.pendingNotificationRequests()
        scheduledCount = scheduled.filter { Self.isOwned($0.content.userInfo) }.count
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

}
