import SwiftUI
import WidgetKit

// MARK: - Shared Widget Building Blocks

private struct WidgetNoticeView: View {
    @Environment(\.widgetFamily) private var family
    let title: String
    let detail: String

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(title)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Text("BIST").font(.caption2.weight(.semibold))
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline).lineLimit(1)
                Text(detail).font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 6) {
                Text("Hisse Analizi")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        }
    }
}

private struct ChangeBadge: View {
    let percent: Double?

    var body: some View {
        Text(MarketFormat.percent(percent))
            .font(.system(.caption2, design: .monospaced).weight(.semibold))
            .foregroundStyle(WidgetPalette.changeColor(percent))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }
}

private struct StockMiniRow: View {
    let stock: StockQuote

    var body: some View {
        HStack(spacing: 6) {
            Text(stock.ticker)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(MarketFormat.price(stock.last))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            ChangeBadge(percent: stock.changePercent)
                .frame(minWidth: 48, alignment: .trailing)
        }
    }
}

// MARK: - 1. BIST 100 + Market Summary Widget

struct MarketSummaryWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MarketWidgetEntry

    private var isLockScreen: Bool {
        [.accessoryCircular, .accessoryRectangular, .accessoryInline].contains(family)
    }

    private var tapURL: URL {
        switch entry.state {
        case .ready(let snapshot, _):
            if let dashboardId = snapshot.dashboardId, !dashboardId.isEmpty {
                return DeepLinkRouter.url(for: .dashboard(id: dashboardId))
            }
            return DeepLinkRouter.url(for: .market)
        case .notPaired, .removed:
            return DeepLinkRouter.url(for: .pair(server: nil, code: ""))
        case .unavailable:
            return DeepLinkRouter.url(for: .market)
        }
    }

    var body: some View {
        Group {
            switch entry.state {
            case .ready(let snapshot, let isOffline):
                readyView(snapshot, isOffline: isOffline)
            case .notPaired:
                WidgetNoticeView(title: "Widget'ı bağla", detail: "Web uygulamasından QR kod oluşturup eşleştir.")
            case .removed:
                WidgetNoticeView(title: "Bağlantı kaldırıldı", detail: "Yeniden bağlamak için uygulamayı aç.")
            case .unavailable:
                WidgetNoticeView(title: "Veri alınamadı", detail: "Birkaç dakika içinde yeniden denenecek.")
            }
        }
        .widgetURL(tapURL)
        .containerBackground(for: .widget) {
            if isLockScreen {
                Color.clear
            } else {
                Color(.secondarySystemBackground)
            }
        }
    }

    @ViewBuilder
    private func readyView(_ snapshot: MarketSnapshot, isOffline: Bool) -> some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 1) {
                    Text("XU100").font(.system(size: 9, weight: .semibold))
                    Text(MarketFormat.percent(snapshot.bist100.changePercent))
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                }
                .padding(.horizontal, 4)
            }

        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("BIST 100").font(.caption.weight(.bold)).widgetAccentable()
                    Spacer(minLength: 4)
                    Text(MarketFormat.percent(snapshot.bist100.changePercent))
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                }
                Text(MarketFormat.index(snapshot.bist100.last))
                    .font(.system(.headline, design: .monospaced).weight(.bold))
                if let next = snapshot.nextEvent {
                    Text("\(next.kind.labelTR): \(next.title)")
                        .font(.caption2)
                        .lineLimit(1)
                } else {
                    Text(snapshot.dataStampLabel(isOffline: isOffline))
                        .font(.caption2)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

        case .accessoryInline:
            Text("BIST 100 \(MarketFormat.index(snapshot.bist100.last)) \(MarketFormat.percent(snapshot.bist100.changePercent))")

        case .systemMedium:
            HStack(spacing: 14) {
                // Left column: BIST 100 + next event
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(snapshot.isSessionOpen && !isOffline ? WidgetPalette.positive : WidgetPalette.neutral)
                            .frame(width: 6, height: 6)
                        Text("BIST 100")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    Text(MarketFormat.index(snapshot.bist100.last))
                        .font(.system(.title3, design: .monospaced).weight(.bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    ChangeBadge(percent: snapshot.bist100.changePercent)

                    Spacer(minLength: 2)

                    if let event = snapshot.nextEvent {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(event.kind.labelTR.uppercased())
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(WidgetPalette.brand)
                            Text(event.title)
                                .font(.caption2.weight(.medium))
                                .lineLimit(1)
                            Text(MarketFormat.shortDateTime(event.scheduledAt))
                                .font(.system(size: 9))
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text(snapshot.dataStampLabel(isOffline: isOffline))
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: 132, maxHeight: .infinity, alignment: .topLeading)

                Divider()

                // Right column: Top selected stocks + timestamp
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(snapshot.watchlist.name)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer()
                        Text(snapshot.dataStampLabel(isOffline: isOffline))
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    ForEach(snapshot.watchlist.items.prefix(4)) { stock in
                        StockMiniRow(stock: stock)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }

        default: // .systemSmall
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Circle()
                        .fill(snapshot.isSessionOpen && !isOffline ? WidgetPalette.positive : WidgetPalette.neutral)
                        .frame(width: 6, height: 6)
                    Text("BIST 100")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                Text(MarketFormat.index(snapshot.bist100.last))
                    .font(.system(.title3, design: .monospaced).weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                ChangeBadge(percent: snapshot.bist100.changePercent)

                Divider()

                ForEach(snapshot.watchlist.items.prefix(2)) { stock in
                    HStack(spacing: 4) {
                        Text(stock.ticker)
                            .font(.system(.caption2, design: .monospaced).weight(.semibold))
                        Spacer()
                        ChangeBadge(percent: stock.changePercent)
                    }
                }

                Spacer(minLength: 0)

                Text(snapshot.dataStampLabel(isOffline: isOffline))
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

struct MarketSummaryWidget: Widget {
    static let kind = "MarketSummaryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: MarketTimelineProvider()) { entry in
            MarketSummaryWidgetView(entry: entry)
        }
        .configurationDisplayName("BIST Özeti")
        .description("BIST 100 günlük değişimi, seçili hisseler ve sıradaki finansal olay.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - 2. Watchlist Widget

struct WatchlistWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MarketWidgetEntry

    private var isLockScreen: Bool { family == .accessoryRectangular }

    private var tapURL: URL {
        switch entry.state {
        case .ready(let snapshot, _):
            return DeepLinkRouter.url(for: .watchlist(id: snapshot.watchlist.id))
        case .notPaired, .removed:
            return DeepLinkRouter.url(for: .pair(server: nil, code: ""))
        case .unavailable:
            return DeepLinkRouter.url(for: .watchlist(id: "favorites"))
        }
    }

    var body: some View {
        Group {
            switch entry.state {
            case .ready(let snapshot, let isOffline):
                readyView(snapshot, isOffline: isOffline)
            case .notPaired:
                WidgetNoticeView(title: "Takip listesi bağlı değil", detail: "Webden QR kodla eşleştir.")
            case .removed:
                WidgetNoticeView(title: "Bağlantı kaldırıldı", detail: "Yeniden bağlamak için uygulamayı aç.")
            case .unavailable:
                WidgetNoticeView(title: "Fiyat alınamadı", detail: "Biraz sonra yeniden denenecek.")
            }
        }
        .widgetURL(tapURL)
        .containerBackground(for: .widget) {
            if isLockScreen { Color.clear } else { Color(.secondarySystemBackground) }
        }
    }

    @ViewBuilder
    private func readyView(_ snapshot: MarketSnapshot, isOffline: Bool) -> some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text(snapshot.watchlist.name).font(.caption2.weight(.bold)).widgetAccentable()
                ForEach(snapshot.watchlist.items.prefix(2)) { stock in
                    HStack {
                        Text(stock.ticker).font(.system(.caption2, design: .monospaced).weight(.semibold))
                        Spacer()
                        Text("\(MarketFormat.price(stock.last)) \(MarketFormat.percent(stock.changePercent))")
                            .font(.system(.caption2, design: .monospaced))
                            .lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

        case .systemMedium:
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(snapshot.watchlist.name)
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text(snapshot.dataStampLabel(isOffline: isOffline))
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                Divider()
                let items = Array(snapshot.watchlist.items.prefix(6))
                let left = Array(items.prefix(3))
                let right = Array(items.dropFirst(3))
                HStack(alignment: .top, spacing: 14) {
                    VStack(spacing: 6) {
                        ForEach(left) { StockMiniRow(stock: $0) }
                    }
                    if !right.isEmpty {
                        Divider()
                        VStack(spacing: 6) {
                            ForEach(right) { StockMiniRow(stock: $0) }
                        }
                    }
                }
                Spacer(minLength: 0)
            }

        default: // .systemSmall
            VStack(alignment: .leading, spacing: 5) {
                Text(snapshot.watchlist.name)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Divider()
                ForEach(snapshot.watchlist.items.prefix(4)) { stock in
                    HStack(spacing: 4) {
                        Text(stock.ticker)
                            .font(.system(.caption2, design: .monospaced).weight(.semibold))
                        Spacer()
                        ChangeBadge(percent: stock.changePercent)
                    }
                }
                Spacer(minLength: 0)
                Text(snapshot.dataStampLabel(isOffline: isOffline))
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

struct WatchlistWidget: Widget {
    static let kind = "WatchlistWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: MarketTimelineProvider()) { entry in
            WatchlistWidgetView(entry: entry)
        }
        .configurationDisplayName("Takip Listesi")
        .description("Seçili hisselerin son fiyatı ve günlük değişimi.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - 3. Upcoming Financial Events Widget

struct UpcomingEventsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MarketWidgetEntry

    private var isLockScreen: Bool {
        [.accessoryRectangular, .accessoryInline].contains(family)
    }

    private var tapURL: URL {
        switch entry.state {
        case .ready(let snapshot, _):
            if let next = snapshot.nextEvent, let url = URL(string: next.deepLink) {
                return url
            }
            return DeepLinkRouter.url(for: .market)
        case .notPaired, .removed:
            return DeepLinkRouter.url(for: .pair(server: nil, code: ""))
        case .unavailable:
            return DeepLinkRouter.url(for: .market)
        }
    }

    var body: some View {
        Group {
            switch entry.state {
            case .ready(let snapshot, let isOffline):
                readyView(snapshot, isOffline: isOffline)
            case .notPaired:
                WidgetNoticeView(title: "Takvim bağlı değil", detail: "Webden QR kodla eşleştir.")
            case .removed:
                WidgetNoticeView(title: "Bağlantı kaldırıldı", detail: "Yeniden bağlamak için uygulamayı aç.")
            case .unavailable:
                WidgetNoticeView(title: "Takvim alınamadı", detail: "Biraz sonra yeniden denenecek.")
            }
        }
        .widgetURL(tapURL)
        .containerBackground(for: .widget) {
            if isLockScreen { Color.clear } else { Color(.secondarySystemBackground) }
        }
    }

    @ViewBuilder
    private func readyView(_ snapshot: MarketSnapshot, isOffline: Bool) -> some View {
        let events = Array(snapshot.upcomingEvents.prefix(family == .systemMedium ? 3 : 2))
        switch family {
        case .accessoryInline:
            if let first = events.first {
                Text("\(first.kind.labelTR): \(first.title)")
            } else {
                Text("Yaklaşan olay yok")
            }

        case .accessoryRectangular:
            if let first = events.first {
                VStack(alignment: .leading, spacing: 2) {
                    Text(first.kind.labelTR).font(.caption2.weight(.bold)).widgetAccentable()
                    Text(first.title).font(.caption.weight(.semibold)).lineLimit(1)
                    Text(MarketFormat.shortDateTime(first.scheduledAt)).font(.caption2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("Yaklaşan finansal olay yok").font(.caption)
            }

        default:
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Yaklaşan Olaylar")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    if isOffline {
                        Text("Çevrimdışı")
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                    }
                }
                Divider()
                if events.isEmpty {
                    Text("Önümüzdeki haftalarda kayıtlı bilanço, temettü veya PPK olayı yok.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(events) { event in
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 4) {
                                Text(event.kind.labelTR)
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(WidgetPalette.brand)
                                Spacer()
                                Text(MarketFormat.shortDateTime(event.scheduledAt))
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            Text(event.title)
                                .font(.caption2.weight(.medium))
                                .lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct UpcomingEventsWidget: Widget {
    static let kind = "UpcomingEventsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: MarketTimelineProvider()) { entry in
            UpcomingEventsWidgetView(entry: entry)
        }
        .configurationDisplayName("Yaklaşan Olaylar")
        .description("Takipli hisselerin bilanço, temettü ve TCMB/ekonomik takvim olayları.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Widget Bundle

@main
struct HisseAnaliziWidgets: WidgetBundle {
    var body: some Widget {
        MarketSummaryWidget()
        WatchlistWidget()
        UpcomingEventsWidget()
    }
}
