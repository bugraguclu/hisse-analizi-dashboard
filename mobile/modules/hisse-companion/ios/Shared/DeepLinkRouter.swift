import Foundation

/// Outgoing WidgetKit destinations. Expo owns incoming URL validation and navigation.
enum AppRoute: Sendable {
    case market
    case watchlist(id: String)
    case dashboard(id: String)
    case pair(server: String?, code: String)
}

enum DeepLinkRouter {
    static func url(for route: AppRoute) -> URL {
        var components = URLComponents()
        components.scheme = "hisseanalizi"
        switch route {
        case .market:
            components.host = "market"
        case .watchlist(let id):
            components.host = "watchlist"
            components.percentEncodedPath = "/" + encodeSegment(id)
        case .dashboard(let id):
            components.host = "dashboard"
            components.percentEncodedPath = "/" + encodeSegment(id)
        case .pair(let server, let code):
            components.host = "pair"
            components.queryItems = [URLQueryItem(name: "code", value: code)]
            if let server { components.queryItems?.append(URLQueryItem(name: "server", value: server)) }
        }
        // Scheme/hosts are fixed and every variable component is percent-encoded.
        return components.url!
    }

    private static func encodeSegment(_ value: String) -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }
}
