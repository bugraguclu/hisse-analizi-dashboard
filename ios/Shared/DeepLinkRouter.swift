import Foundation

/// Deep-link targets accepted from WidgetKit taps, local calendar reminders, Siri Shortcuts, and QR pairing.
enum AppRoute: Equatable, Sendable {
    case market
    case stock(ticker: String, tab: String?)
    case watchlist(id: String)
    case dashboard(id: String)
    case event(id: String)
    case pair(server: String?, code: String)
    case unknown
}

enum DeepLinkRouter {
    static let scheme = "hisseanalizi"

    static func parse(_ url: URL) -> AppRoute? {
        guard url.scheme?.lowercased() == scheme else { return nil }
        let host = (url.host ?? "").lowercased()
        let parts = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let query: [String: String] = Dictionary(
            queryItems.compactMap { item in item.value.map { (item.name.lowercased(), $0) } },
            uniquingKeysWith: { first, _ in first }
        )

        switch host {
        case "market", "home", "":
            return .market
        case "stock", "hisse":
            guard let raw = parts.first ?? query["ticker"], let ticker = normalizeTicker(raw) else {
                return .unknown
            }
            return .stock(ticker: ticker, tab: query["tab"])
        case "watchlist", "liste":
            let id = (parts.first ?? query["id"] ?? "favorites").trimmingCharacters(in: .whitespacesAndNewlines)
            return .watchlist(id: id.isEmpty ? "favorites" : id)
        case "dashboard", "pano":
            let id = (parts.first ?? query["id"] ?? "home").trimmingCharacters(in: .whitespacesAndNewlines)
            return .dashboard(id: id.isEmpty ? "home" : id)
        case "event", "olay":
            let id = (parts.first ?? query["id"] ?? query["event"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return id.isEmpty ? .unknown : .event(id: id)
        case "macro":
            if let eventId = query["event"], !eventId.isEmpty {
                return .event(id: eventId)
            }
            return .market
        case "pair":
            guard let code = query["code"], !code.isEmpty else { return .unknown }
            return .pair(server: query["server"], code: code)
        default:
            return .unknown
        }
    }

    static func url(for route: AppRoute) -> URL {
        switch route {
        case .market, .unknown:
            return URL(string: "\(scheme)://market")!
        case .stock(let ticker, let tab):
            let clean = normalizeTicker(ticker) ?? "THYAO"
            if let tab, !tab.isEmpty {
                return URL(string: "\(scheme)://stock/\(clean)?tab=\(tab)")!
            }
            return URL(string: "\(scheme)://stock/\(clean)")!
        case .watchlist(let id):
            let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "favorites"
            return URL(string: "\(scheme)://watchlist/\(encoded)")!
        case .dashboard(let id):
            let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "home"
            return URL(string: "\(scheme)://dashboard/\(encoded)")!
        case .event(let id):
            let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
            return URL(string: "\(scheme)://event/\(encoded)")!
        case .pair(let server, let code):
            var comps = URLComponents()
            comps.scheme = scheme
            comps.host = "pair"
            var items = [URLQueryItem(name: "code", value: code)]
            if let server { items.insert(URLQueryItem(name: "server", value: server), at: 0) }
            comps.queryItems = items
            return comps.url ?? URL(string: "\(scheme)://pair")!
        }
    }

    static func normalizeTicker(_ raw: String) -> String? {
        var cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if cleaned.hasSuffix(".IS") { cleaned.removeLast(3) }
        guard cleaned.count >= 2, cleaned.count <= 10,
              cleaned.allSatisfy({ ($0 >= "A" && $0 <= "Z") || ($0 >= "0" && $0 <= "9") }) else {
            return nil
        }
        return cleaned
    }
}

/// Validates server origins from QR pairing links so a stranger's QR code cannot silently redirect the widget.
enum TrustedOriginChecker {
    static func origin(_ address: String) -> String? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host?.lowercased(),
              !host.isEmpty else {
            return nil
        }
        let port = url.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }

    static func isTrusted(address: String, defaultServer: String, pairedServer: String?) -> Bool {
        guard let candidate = origin(address) else { return false }
        let allowed = [defaultServer, pairedServer].compactMap { $0.flatMap(origin) }
        return allowed.contains(candidate)
    }
}

/// Prevents the same deep link or NSUserActivity from being routed twice during cold launch.
struct DuplicateRouteGuard: Sendable {
    private var lastURL: String?
    private var lastAt: Date?
    let windowSeconds: TimeInterval

    init(windowSeconds: TimeInterval = 1.5) {
        self.windowSeconds = windowSeconds
    }

    mutating func shouldProcess(_ urlString: String, now: Date = .now) -> Bool {
        if let prev = lastURL, let prevAt = lastAt, prev == urlString, now.timeIntervalSince(prevAt) < windowSeconds {
            return false
        }
        lastURL = urlString
        lastAt = now
        return true
    }
}
