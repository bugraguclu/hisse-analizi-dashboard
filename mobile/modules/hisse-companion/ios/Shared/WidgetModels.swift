import Foundation

/// Calendar event categories supported for widget previews and local reminders.
enum CalendarEventKind: String, Codable, CaseIterable, Hashable, Sendable {
    case earnings
    case dividend
    case economic

    var labelTR: String {
        switch self {
        case .earnings: return "Bilanço"
        case .dividend: return "Temettü"
        case .economic: return "Ekonomik"
        }
    }

    var systemImage: String {
        switch self {
        case .earnings: return "doc.text.magnifyingglass"
        case .dividend: return "banknote"
        case .economic: return "calendar.badge.clock"
        }
    }
}

struct IndexQuote: Codable, Equatable, Sendable {
    var symbol: String
    var name: String
    var last: Double?
    var change: Double?
    var changePercent: Double?
    var updatedAt: String?
    var sessionState: String?

    enum CodingKeys: String, CodingKey {
        case symbol, name, last, change
        case changePercent = "change_percent"
        case updatedAt = "updated_at"
        case sessionState = "session_state"
    }
}

struct StockQuote: Codable, Equatable, Identifiable, Sendable {
    var ticker: String
    var name: String?
    var last: Double?
    var change: Double?
    var changePercent: Double?
    var updatedAt: String?

    var id: String { ticker }

    enum CodingKeys: String, CodingKey {
        case ticker, name, last, change
        case changePercent = "change_percent"
        case updatedAt = "updated_at"
    }
}

struct WatchlistSummary: Codable, Equatable, Sendable {
    var id: String
    var name: String
    var items: [StockQuote]
}

struct CalendarEventItem: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var kind: CalendarEventKind
    var title: String
    var subtitle: String?
    var ticker: String?
    var country: String?
    var scheduledAt: Date
    var date: String
    var endDate: String?
    var importance: String?
    var deepLink: String

    enum CodingKeys: String, CodingKey {
        case id, kind, title, subtitle, ticker, country, date, importance
        case scheduledAt = "scheduled_at"
        case endDate = "end_date"
        case deepLink = "deep_link"
    }
}

/// Read-only market snapshot shared between the main iOS app and WidgetKit extensions.
struct MarketSnapshot: Codable, Equatable, Sendable {
    var generatedAt: Date
    var dataAsOf: String?
    var timezone: String
    var sessionState: String
    var delaySeconds: Int
    var stale: Bool
    var bist100: IndexQuote
    var watchlist: WatchlistSummary
    var upcomingEvents: [CalendarEventItem]
    var dashboardId: String?
    var fetchedAt: Date

    enum CodingKeys: String, CodingKey {
        case timezone, stale, bist100, watchlist
        case generatedAt = "generated_at"
        case dataAsOf = "data_as_of"
        case sessionState = "session_state"
        case delaySeconds = "delay_seconds"
        case upcomingEvents = "upcoming_events"
        case dashboardId = "dashboard_id"
        case fetchedAt = "fetched_at"
    }

    init(
        generatedAt: Date,
        dataAsOf: String?,
        timezone: String,
        sessionState: String,
        delaySeconds: Int,
        stale: Bool,
        bist100: IndexQuote,
        watchlist: WatchlistSummary,
        upcomingEvents: [CalendarEventItem],
        dashboardId: String?,
        fetchedAt: Date = .now
    ) {
        self.generatedAt = generatedAt
        self.dataAsOf = dataAsOf
        self.timezone = timezone
        self.sessionState = sessionState
        self.delaySeconds = delaySeconds
        self.stale = stale
        self.bist100 = bist100
        self.watchlist = watchlist
        self.upcomingEvents = upcomingEvents
        self.dashboardId = dashboardId
        self.fetchedAt = fetchedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decode(Date.self, forKey: .generatedAt)
        dataAsOf = try c.decodeIfPresent(String.self, forKey: .dataAsOf)
        timezone = try c.decodeIfPresent(String.self, forKey: .timezone) ?? "Europe/Istanbul"
        sessionState = try c.decodeIfPresent(String.self, forKey: .sessionState) ?? "closed"
        delaySeconds = try c.decodeIfPresent(Int.self, forKey: .delaySeconds) ?? 900
        stale = try c.decodeIfPresent(Bool.self, forKey: .stale) ?? false
        bist100 = try c.decode(IndexQuote.self, forKey: .bist100)
        watchlist = try c.decode(WatchlistSummary.self, forKey: .watchlist)
        upcomingEvents = try c.decodeIfPresent([CalendarEventItem].self, forKey: .upcomingEvents) ?? []
        dashboardId = try c.decodeIfPresent(String.self, forKey: .dashboardId)
        fetchedAt = try c.decodeIfPresent(Date.self, forKey: .fetchedAt) ?? generatedAt
    }

    var isSessionOpen: Bool { sessionState.lowercased() == "open" }

    var delayLabel: String? {
        guard delaySeconds >= 60 else { return nil }
        return "\(delaySeconds / 60) dk gecikmeli"
    }

    var nextEvent: CalendarEventItem? {
        upcomingEvents.first { $0.scheduledAt >= Date.now.addingTimeInterval(-900) } ?? upcomingEvents.first
    }

    /// Human-readable data timestamp in Europe/Istanbul so stale/offline data is always explicit.
    func dataStampLabel(isOffline: Bool) -> String {
        let timeStr = MarketFormat.shortStamp(fromISO: dataAsOf) ?? MarketFormat.shortTime(fetchedAt)
        if isOffline {
            return "Çevrimdışı · \(timeStr)"
        }
        if stale {
            return "Eski veri · \(timeStr)"
        }
        if let delay = delayLabel {
            return "\(timeStr) · \(delay)"
        }
        return timeStr
    }

    static var sample: MarketSnapshot {
        let now = Date.now
        return MarketSnapshot(
            generatedAt: now,
            dataAsOf: nil,
            timezone: "Europe/Istanbul",
            sessionState: "open",
            delaySeconds: 900,
            stale: false,
            bist100: IndexQuote(
                symbol: "XU100",
                name: "BIST 100",
                last: 10245.50,
                change: 142.30,
                changePercent: 1.41,
                updatedAt: nil,
                sessionState: "open"
            ),
            watchlist: WatchlistSummary(
                id: "favorites",
                name: "Favoriler",
                items: [
                    StockQuote(ticker: "THYAO", name: "Türk Hava Yolları", last: 312.50, change: 6.00, changePercent: 1.96, updatedAt: nil),
                    StockQuote(ticker: "GARAN", name: "Garanti BBVA", last: 124.20, change: -1.10, changePercent: -0.88, updatedAt: nil),
                    StockQuote(ticker: "ASELS", name: "Aselsan", last: 78.40, change: 2.15, changePercent: 2.82, updatedAt: nil),
                    StockQuote(ticker: "SISE", name: "Şişecam", last: 43.90, change: 0.25, changePercent: 0.57, updatedAt: nil),
                ]
            ),
            upcomingEvents: [
                CalendarEventItem(
                    id: "tcmb:ppk:2026-11-26",
                    kind: .economic,
                    title: "PPK Faiz Kararı",
                    subtitle: "TCMB",
                    ticker: nil,
                    country: "TR",
                    scheduledAt: now.addingTimeInterval(3 * 86_400),
                    date: "2026-11-26",
                    endDate: nil,
                    importance: "high",
                    deepLink: "hisseanalizi://event/tcmb:ppk:2026-11-26"
                ),
                CalendarEventItem(
                    id: "earnings:THYAO:2026-9-aylik",
                    kind: .earnings,
                    title: "THYAO 3. Çeyrek Bilanço",
                    subtitle: "2026 · 9 Aylık",
                    ticker: "THYAO",
                    country: "TR",
                    scheduledAt: now.addingTimeInterval(5 * 86_400),
                    date: "2026-11-28",
                    endDate: "2026-11-30",
                    importance: "high",
                    deepLink: "hisseanalizi://stock/THYAO?tab=financials"
                ),
            ],
            dashboardId: "home",
            fetchedAt: now
        )
    }
}

enum MarketFormat {
    static let istanbulTimeZone = TimeZone(identifier: "Europe/Istanbul") ?? .current
    static let turkishLocale = Locale(identifier: "tr_TR")

    private static let priceFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = turkishLocale
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()

    private static let indexFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = turkishLocale
        f.numberStyle = .decimal
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 2
        return f
    }()

    static func price(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        return priceFormatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    }

    static func index(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        return indexFormatter.string(from: NSNumber(value: value)) ?? String(format: "%.0f", value)
    }

    static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let sign = value > 0 ? "+" : ""
        let formatted = priceFormatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
        return "%\(sign)\(formatted)"
    }

    static func shortTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = turkishLocale
        f.timeZone = istanbulTimeZone
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }

    static func shortDateTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = turkishLocale
        f.timeZone = istanbulTimeZone
        f.dateFormat = "d MMM HH:mm"
        return f.string(from: date)
    }

    static func shortStamp(fromISO iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = parser.date(from: iso) {
            return shortDateTime(date)
        }
        parser.formatOptions = [.withInternetDateTime]
        if let date = parser.date(from: iso) {
            return shortDateTime(date)
        }
        return nil
    }
}
