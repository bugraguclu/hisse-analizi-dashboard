import Foundation
import Security

enum AppGroup {
    static let identifier = "group.com.bugraguclu.hisseanalizi"
    static let keychainService = "com.bugraguclu.hisseanalizi.widget-token"
    static let keychainAccount = "paired-device-token"
    static var defaults: UserDefaults { UserDefaults(suiteName: identifier) ?? .standard }
}

/// Paired server URL + read-only widget bearer token (`scope: "widget:read"`).
struct Pairing: Equatable, Sendable {
    var server: URL
    var token: String
    var deviceName: String
}

/// Keychain wrapper for storing the read-only widget token securely across App & Widget targets.
enum KeychainTokenStore {
    private static let fallbackDefaultsKey = "widgetTokenFallback"

    static func readToken() -> String? {
        AppGroup.defaults.removeObject(forKey: fallbackDefaultsKey)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AppGroup.keychainService,
            kSecAttrAccount as String: AppGroup.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let token = String(data: data, encoding: .utf8), !token.isEmpty {
            return token
        }
        return nil
    }

    static func saveToken(_ token: String) throws {
        let data = Data(token.utf8)
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AppGroup.keychainService,
            kSecAttrAccount as String: AppGroup.keychainAccount,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        let status: OSStatus
        if updateStatus == errSecItemNotFound {
            let addQuery = baseQuery.merging(attributes) { _, new in new }
            status = SecItemAdd(addQuery as CFDictionary, nil)
        } else {
            status = updateStatus
        }
        // Remove plaintext credentials left by earlier development builds, even on failure.
        AppGroup.defaults.removeObject(forKey: fallbackDefaultsKey)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [
                NSLocalizedDescriptionKey: "Cihaz anahtarı güvenli biçimde kaydedilemedi. Yeniden eşleştirin.",
            ])
        }
    }

    static func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AppGroup.keychainService,
            kSecAttrAccount as String: AppGroup.keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
        AppGroup.defaults.removeObject(forKey: fallbackDefaultsKey)
    }
}

/// State shared between the iOS app and its WidgetKit extensions through the App Group + Keychain.
enum ConnectionStore {
    private struct PairingMeta: Codable {
        var server: URL
        var deviceName: String
    }

    private static let metaKey = "pairingMeta"
    private static let snapshotKey = "marketSnapshot"
    private static let removedKey = "pairingRemoved"
    private static let reminderPrefsKey = "calendarReminderPrefs"

    static var pairing: Pairing? {
        get {
            guard let meta = read(PairingMeta.self, metaKey),
                  let token = KeychainTokenStore.readToken(),
                  !token.isEmpty else {
                return nil
            }
            return Pairing(server: meta.server, token: token, deviceName: meta.deviceName)
        }
    }

    static func savePairing(_ value: Pairing) throws {
        try KeychainTokenStore.saveToken(value.token)
        write(PairingMeta(server: value.server, deviceName: value.deviceName), metaKey)
        removed = false
    }

    static var snapshot: MarketSnapshot? {
        get { read(MarketSnapshot.self, snapshotKey) }
        set { write(newValue, snapshotKey) }
    }

    /// True when the server revoked the device token (401), so both app and widgets explain it clearly.
    static var removed: Bool {
        get { AppGroup.defaults.bool(forKey: removedKey) }
        set { AppGroup.defaults.set(newValue, forKey: removedKey) }
    }

    static var reminderPreferences: CalendarReminderPreferences {
        get { read(CalendarReminderPreferences.self, reminderPrefsKey) ?? .default }
        set { write(newValue, reminderPrefsKey) }
    }

    static func forget(removedByServer: Bool) {
        KeychainTokenStore.deleteToken()
        AppGroup.defaults.removeObject(forKey: metaKey)
        snapshot = nil
        removed = removedByServer
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private static func read<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        AppGroup.defaults.data(forKey: key).flatMap { try? decoder.decode(type, from: $0) }
    }

    private static func write<T: Encodable>(_ value: T?, _ key: String) {
        if let value, let data = try? encoder.encode(value) {
            AppGroup.defaults.set(data, forKey: key)
        } else {
            AppGroup.defaults.removeObject(forKey: key)
        }
    }
}
