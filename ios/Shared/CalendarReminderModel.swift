import Foundation

/// Lead time before a scheduled financial event when a local notification should fire.
enum ReminderLeadTime: String, Codable, CaseIterable, Identifiable, Sendable {
    case minutes15
    case hour1
    case dayBeforeMorning

    var id: String { rawValue }

    var labelTR: String {
        switch self {
        case .minutes15: return "15 dk önce"
        case .hour1: return "1 saat önce"
        case .dayBeforeMorning: return "1 gün önce (09:00)"
        }
    }

    func fireDate(for scheduledAt: Date, timeZone: TimeZone = MarketFormat.istanbulTimeZone) -> Date {
        switch self {
        case .minutes15:
            return scheduledAt.addingTimeInterval(-15 * 60)
        case .hour1:
            return scheduledAt.addingTimeInterval(-60 * 60)
        case .dayBeforeMorning:
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = timeZone
            guard let prevDay = cal.date(byAdding: .day, value: -1, to: scheduledAt) else {
                return scheduledAt.addingTimeInterval(-86_400)
            }
            var comps = cal.dateComponents([.year, .month, .day], from: prevDay)
            comps.hour = 9
            comps.minute = 0
            comps.second = 0
            return cal.date(from: comps) ?? scheduledAt.addingTimeInterval(-86_400)
        }
    }
}

struct CalendarReminderPreferences: Codable, Equatable, Sendable {
    var enabled: Bool
    var leadTime: ReminderLeadTime
    var enabledKinds: Set<CalendarEventKind>
    /// Individual event IDs explicitly opted into or muted by the user.
    var mutedEventIds: Set<String>

    static let `default` = CalendarReminderPreferences(
        enabled: false,
        leadTime: .hour1,
        enabledKinds: Set(CalendarEventKind.allCases),
        mutedEventIds: []
    )
}

struct PlannedReminder: Equatable, Sendable {
    let identifier: String
    let eventId: String
    let eventKind: CalendarEventKind
    let title: String
    let body: String
    let fireDate: Date
    let deepLink: String
    let ticker: String?
}

struct ReminderDiff: Equatable, Sendable {
    let toCancel: [String]
    let toSchedule: [PlannedReminder]
}

/// Pure local-notification planner and reconciler (adapted from TusAnkiM's studyReminderSchedule).
///
/// Enforces iOS's 64 pending local notification limit by capping owned reminders at 48,
/// computes fire dates in Europe/Istanbul, and cleanly reschedules when an event's date shifts.
enum CalendarReminderPlanner {
    static let ownedKind = "hisse.calendar.reminder"
    static let identifierPrefix = "hisse.calendar.reminder."
    static let maxOwnedNotifications = 48

    static func identifier(for eventId: String) -> String {
        "\(identifierPrefix)\(eventId)"
    }

    static func plan(
        events: [CalendarEventItem],
        preferences: CalendarReminderPreferences,
        now: Date = .now,
        timeZone: TimeZone = MarketFormat.istanbulTimeZone
    ) -> [PlannedReminder] {
        guard preferences.enabled else { return [] }

        var planned: [PlannedReminder] = []
        var seenEventIds = Set<String>()

        for event in events {
            guard !seenEventIds.contains(event.id) else { continue }
            guard preferences.enabledKinds.contains(event.kind) else { continue }
            guard !preferences.mutedEventIds.contains(event.id) else { continue }

            let fireDate = preferences.leadTime.fireDate(for: event.scheduledAt, timeZone: timeZone)
            // Skip reminders whose fire date is already in the past.
            guard fireDate > now.addingTimeInterval(30) else { continue }

            seenEventIds.insert(event.id)
            let whenText = MarketFormat.shortDateTime(event.scheduledAt)
            let bodyParts = [event.subtitle, whenText].compactMap { $0 }.filter { !$0.isEmpty }
            planned.append(
                PlannedReminder(
                    identifier: identifier(for: event.id),
                    eventId: event.id,
                    eventKind: event.kind,
                    title: "\(event.kind.labelTR): \(event.title)",
                    body: bodyParts.joined(separator: " · "),
                    fireDate: fireDate,
                    deepLink: event.deepLink,
                    ticker: event.ticker
                )
            )
        }

        return Array(
            planned
                .sorted { $0.fireDate < $1.fireDate }
                .prefix(maxOwnedNotifications)
        )
    }

    /// Reconciles currently scheduled owned notifications against the new plan.
    /// Any removed event OR any event whose fire date shifted is cancelled and rescheduled cleanly.
    static func reconcile(
        existing: [String: Date],
        desired: [PlannedReminder]
    ) -> ReminderDiff {
        let desiredById = Dictionary(uniqueKeysWithValues: desired.map { ($0.identifier, $0) })
        var toCancel: [String] = []
        var toSchedule: [PlannedReminder] = []

        for (id, scheduledDate) in existing {
            guard let target = desiredById[id] else {
                toCancel.append(id)
                continue
            }
            // If event date or lead time moved by >= 60 seconds, cancel and reschedule.
            if abs(target.fireDate.timeIntervalSince(scheduledDate)) >= 60 {
                toCancel.append(id)
                toSchedule.append(target)
            }
        }

        for item in desired where existing[item.identifier] == nil {
            toSchedule.append(item)
        }

        return ReminderDiff(
            toCancel: toCancel.sorted(),
            toSchedule: toSchedule.sorted { $0.fireDate < $1.fireDate }
        )
    }
}
