import Foundation

@main
enum SharedTests {
    static var passed = 0
    static var failed = 0

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String, file: String = #file, line: Int = #line) {
        if condition() {
            passed += 1
        } else {
            failed += 1
            fputs("FAIL (\(file):\(line)): \(message)\n", stderr)
        }
    }

    static func main() {
        // Widget URLs preserve their payload; incoming validation belongs to the Expo tests.
        let identifier = "list/banka?x=1#detay"
        let listURL = DeepLinkRouter.url(for: .watchlist(id: identifier))
        expect(listURL.host == "watchlist", "Watchlist widget must open the web list route")
        expect(listURL.query == nil && listURL.fragment == nil, "List IDs cannot inject query or fragment")
        expect(String(listURL.path.dropFirst()).removingPercentEncoding == identifier, "Encoded list ID must survive URL generation")
        let pairURL = DeepLinkRouter.url(for: .pair(server: "https://example.test", code: "ABCD2345"))
        let query = URLComponents(url: pairURL, resolvingAgainstBaseURL: false)!.queryItems!
        expect(query.first { $0.name == "server" }?.value == "https://example.test", "Pairing destination must be encoded")
        expect(query.first { $0.name == "code" }?.value == "ABCD2345", "Pairing code must be encoded")

        // CalendarReminderPlanner: Istanbul TZ, 48-cap budget, date-shift reconciliation
        let now = ISO8601DateFormatter().date(from: "2026-11-20T09:00:00+03:00")!
        var events: [CalendarEventItem] = []
        for i in 1...60 {
            let scheduled = now.addingTimeInterval(Double(i) * 86_400)
            events.append(
                CalendarEventItem(
                    id: "ev-\(i)",
                    kind: i % 3 == 0 ? .dividend : (i % 2 == 0 ? .earnings : .economic),
                    title: "Olay \(i)",
                    subtitle: "Detay \(i)",
                    ticker: i % 2 == 0 ? "THYAO" : nil,
                    country: "TR",
                    scheduledAt: scheduled,
                    date: "2026-11-21",
                    endDate: nil,
                    importance: "high",
                    deepLink: "hisseanalizi://event/ev-\(i)"
                )
            )
        }

        var prefs = CalendarReminderPreferences.default
        prefs.enabled = true
        prefs.leadTime = .hour1

        let planned = CalendarReminderPlanner.plan(events: events, preferences: prefs, now: now)
        expect(planned.count == CalendarReminderPlanner.maxOwnedNotifications, "Must cap owned notifications at 48 under iOS 64 limit")
        expect(planned.first?.eventId == "ev-1", "Earliest event scheduled first")

        let ev1Id = CalendarReminderPlanner.identifier(for: "ev-1")
        let evRemovedId = CalendarReminderPlanner.identifier(for: "ev-old")
        let existing: [String: Date] = [
            ev1Id: planned[0].fireDate.addingTimeInterval(7200),
            evRemovedId: now.addingTimeInterval(3600),
        ]
        let diff = CalendarReminderPlanner.reconcile(existing: existing, desired: Array(planned.prefix(2)))
        expect(diff.toCancel.contains(ev1Id), "Shifted event must cancel old trigger")
        expect(diff.toCancel.contains(evRemovedId), "Removed event must be cancelled")
        expect(diff.toSchedule.contains(where: { $0.identifier == ev1Id }), "Shifted event must be rescheduled")
        expect(diff.toSchedule.count == 2, "Should schedule shifted ev-1 and new ev-2")

        let sameTime: [String: Date] = [ev1Id: planned[0].fireDate]
        let renamed = CalendarReminderPlanner.reconcile(
            existing: sameTime,
            desired: [planned[0]],
            existingContent: [ev1Id: "old title"]
        )
        expect(renamed.toCancel == [ev1Id] && renamed.toSchedule.count == 1, "Changed text must replace the pending reminder")
        let unchanged = CalendarReminderPlanner.reconcile(
            existing: sameTime,
            desired: [planned[0]],
            existingContent: [ev1Id: planned[0].contentFingerprint]
        )
        expect(unchanged.toCancel.isEmpty && unchanged.toSchedule.isEmpty, "Unchanged reminder must be left alone")
        expect(planned[0].notificationDeepLink.contains("source=notification"), "Reminder links must be tagged as notifications")

        let ppkDate = ISO8601DateFormatter().date(from: "2026-11-26T14:00:00+03:00")!
        let fire = ReminderLeadTime.dayBeforeMorning.fireDate(for: ppkDate)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = MarketFormat.istanbulTimeZone
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
        expect(comps.day == 25 && comps.hour == 9 && comps.minute == 0, "Day-before reminder fires at 09:00 Istanbul time")

        // MarketSnapshot offline & delay labeling
        let snap = MarketSnapshot.sample
        expect(snap.dataStampLabel(isOffline: true).hasPrefix("Çevrimdışı · "), "Offline stamp must be explicit")
        expect(snap.dataStampLabel(isOffline: false).contains("15 dk gecikmeli"), "15-min delay must be visible when online")

        print("iOS Shared Swift tests: \(passed) passed, \(failed) failed")
        if failed > 0 { exit(1) }
    }
}
