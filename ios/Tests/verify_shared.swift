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
        // 1. DeepLinkRouter parsing & URL round-trip
        let stockURL = URL(string: "hisseanalizi://stock/thyao.is?tab=financials")!
        expect(DeepLinkRouter.parse(stockURL) == .stock(ticker: "THYAO", tab: "financials"), "Stock route should normalize ticker")

        let pairURL = URL(string: "hisseanalizi://pair?server=https%3A%2F%2Fhisse-analizi.duckdns.org&code=ABCD2345")!
        expect(
            DeepLinkRouter.parse(pairURL) == .pair(server: "https://hisse-analizi.duckdns.org", code: "ABCD2345"),
            "Pair route should decode server and code"
        )

        let watchlistURL = DeepLinkRouter.url(for: .watchlist(id: "list-banka"))
        expect(DeepLinkRouter.parse(watchlistURL) == .watchlist(id: "list-banka"), "Watchlist route round-trip")

        let dashboardURL = DeepLinkRouter.url(for: .dashboard(id: "sabah"))
        expect(DeepLinkRouter.parse(dashboardURL) == .dashboard(id: "sabah"), "Dashboard route round-trip")

        let eventURL = DeepLinkRouter.url(for: .event(id: "tcmb:ppk:2026-11-26"))
        expect(DeepLinkRouter.parse(eventURL) == .event(id: "tcmb:ppk:2026-11-26"), "Event route round-trip")

        let foreignURL = URL(string: "https://example.com/stock/THYAO")!
        expect(DeepLinkRouter.parse(foreignURL) == nil, "Non-hisseanalizi scheme must be ignored")

        // 2. TrustedOriginChecker (QR hijacking prevention)
        let defaultOrigin = "https://hisse-analizi.duckdns.org"
        expect(
            TrustedOriginChecker.isTrusted(address: "https://hisse-analizi.duckdns.org/api", defaultServer: defaultOrigin, pairedServer: nil),
            "Default origin should be trusted"
        )
        expect(
            !TrustedOriginChecker.isTrusted(address: "https://evil.example.com", defaultServer: defaultOrigin, pairedServer: nil),
            "Untrusted third-party server must NOT auto-pair"
        )
        expect(
            TrustedOriginChecker.isTrusted(address: "http://127.0.0.1:3000", defaultServer: defaultOrigin, pairedServer: "http://127.0.0.1:3000"),
            "Already-paired server origin should be trusted"
        )
        expect(
            !TrustedOriginChecker.isTrusted(address: "javascript:alert(1)", defaultServer: defaultOrigin, pairedServer: nil),
            "Non-HTTP(S) scheme must be rejected"
        )

        // 3. DuplicateRouteGuard (cold-launch double routing protection)
        var guardState = DuplicateRouteGuard(windowSeconds: 1.5)
        let t0 = Date(timeIntervalSince1970: 1_700_000_000)
        expect(guardState.shouldProcess("hisseanalizi://stock/THYAO", now: t0), "First route processed")
        expect(!guardState.shouldProcess("hisseanalizi://stock/THYAO", now: t0.addingTimeInterval(0.4)), "Duplicate within window blocked")
        expect(guardState.shouldProcess("hisseanalizi://stock/THYAO", now: t0.addingTimeInterval(2.0)), "Same route after window allowed")

        // 4. CalendarReminderPlanner: Istanbul TZ, 48-cap budget, date-shift reconciliation
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

        let ppkDate = ISO8601DateFormatter().date(from: "2026-11-26T14:00:00+03:00")!
        let fire = ReminderLeadTime.dayBeforeMorning.fireDate(for: ppkDate)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = MarketFormat.istanbulTimeZone
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
        expect(comps.day == 25 && comps.hour == 9 && comps.minute == 0, "Day-before reminder fires at 09:00 Istanbul time")

        // 5. MarketSnapshot offline & delay labeling
        let snap = MarketSnapshot.sample
        expect(snap.dataStampLabel(isOffline: true).hasPrefix("Çevrimdışı · "), "Offline stamp must be explicit")
        expect(snap.dataStampLabel(isOffline: false).contains("15 dk gecikmeli"), "15-min delay must be visible when online")

        print("iOS Shared Swift tests: \(passed) passed, \(failed) failed")
        if failed > 0 { exit(1) }
    }
}
