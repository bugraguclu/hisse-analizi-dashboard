import Foundation

enum WidgetAPIError: LocalizedError, Equatable, Sendable {
    case unpaired
    case refused(String)
    case unreachable
    case serverError

    var errorDescription: String? {
        switch self {
        case .unpaired:
            return "Bağlantı kaldırılmış. Web uygulamasından yeni kod oluşturup yeniden bağlan."
        case .refused(let message):
            return message
        case .unreachable:
            return "Sunucuya ulaşılamadı. İnternet bağlantını ve sunucu adresini kontrol et."
        case .serverError:
            return "Sunucu şu anda yanıt veremiyor. Biraz sonra yeniden dene."
        }
    }
}

enum WidgetAPI {
    private struct PairResponse: Decodable {
        struct Device: Decodable {
            let name: String
        }
        let token: String
        let device: Device
    }

    private struct ErrorReply: Decodable {
        let detail: String?
        let code: String?
    }

    private static let isoWithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = isoWithFractional.date(from: raw) ?? isoPlain.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO8601 date: \(raw)")
        }
        return d
    }()

    /// Resolves `/api/widget/<endpoint>` on Next.js web origins and `/widget/<endpoint>` on direct FastAPI URLs.
    static func endpointURL(server: URL, subpath: String) -> URL {
        let basePath = server.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if basePath == "api" || basePath.hasSuffix("/api") {
            return server.appending(path: "widget/\(subpath)")
        }
        // Standard web origin (e.g. https://hisse.example.com or http://127.0.0.1:3000) proxies via /api/widget/
        if server.port == 8000 {
            return server.appending(path: "widget/\(subpath)")
        }
        return server.appending(path: "api/widget/\(subpath)")
    }

    static func pair(server: URL, code: String, name: String) async throws -> Pairing {
        var request = URLRequest(url: endpointURL(server: server, subpath: "pair"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code, "name": name])
        let reply: PairResponse = try await send(request)
        return Pairing(server: server, token: reply.token, deviceName: reply.device.name)
    }

    static func summary(for pairing: Pairing) async throws -> MarketSnapshot {
        var request = URLRequest(url: endpointURL(server: pairing.server, subpath: "summary"))
        request.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization")
        var snapshot: MarketSnapshot = try await send(request)
        snapshot.fetchedAt = .now
        return snapshot
    }

    /// Best-effort self-unpair: the phone forgets its credentials even if the server cannot be reached.
    static func unpair(_ pairing: Pairing) async {
        var request = URLRequest(url: endpointURL(server: pairing.server, subpath: "summary"))
        request.httpMethod = "DELETE"
        request.timeoutInterval = 8
        request.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization")
        _ = try? await URLSession.shared.data(for: request)
    }

    private static func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        var request = request
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw WidgetAPIError.unreachable
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 {
            throw WidgetAPIError.unpaired
        }
        guard (200..<300).contains(status) else {
            if let failure = try? JSONDecoder().decode(ErrorReply.self, from: data),
               let detail = failure.detail, !detail.isEmpty {
                throw WidgetAPIError.refused(detail)
            }
            throw WidgetAPIError.serverError
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw WidgetAPIError.serverError
        }
    }
}
