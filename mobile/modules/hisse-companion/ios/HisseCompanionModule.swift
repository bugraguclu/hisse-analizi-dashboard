import ExpoModulesCore
import Foundation
import WidgetKit
import UIKit

public final class HisseCompanionModule: Module {
    private var shortcutObserver: NSObjectProtocol?
    public func definition() -> ModuleDefinition {
        Name("HisseCompanion")
        Events("onShortcut")
        OnCreate {
            self.shortcutObserver = NotificationCenter.default.addObserver(forName: Notification.Name("HisseCompanionShortcut"), object: nil, queue: .main) { [weak self] _ in
                self?.sendEvent("onShortcut")
            }
        }
        OnDestroy {
            if let observer = self.shortcutObserver { NotificationCenter.default.removeObserver(observer) }
        }
        AsyncFunction("getState") { () async throws -> String in
            try await CompanionService.shared.state()
        }
        AsyncFunction("pair") { (server: String, code: String) async throws -> String in
            try await CompanionService.shared.pair(server: server, code: code)
        }
        AsyncFunction("refresh") { () async throws -> String in
            try await CompanionService.shared.refresh()
        }
        AsyncFunction("unpair") { () async throws -> String in
            try await CompanionService.shared.unpair()
        }
        AsyncFunction("setReminders") { (enabled: Bool, leadTime: String) async throws -> String in
            try await CompanionService.shared.setReminders(enabled: enabled, leadTime: leadTime)
        }
        AsyncFunction("consumeShortcut") { () async -> String? in
            await CompanionService.shared.consumeShortcut()
        }
    }
}

/// Device tokens stay inside the native module and shared Keychain, never in JS storage.
@MainActor
private final class CompanionService {
    static let shared = CompanionService()
    private let reminders = CalendarReminderManager()
    private var busy = false

    func consumeShortcut() -> String? {
        let defaults = AppGroup.defaults
        let value = defaults.string(forKey: "pendingShortcutURL")
        defaults.removeObject(forKey: "pendingShortcutURL")
        return value
    }

    func state() async throws -> String {
        await reminders.refreshPermissionStatus()
        let snapshot = ConnectionStore.snapshot
        var result: [String: Any] = [
            "paired": ConnectionStore.pairing != nil,
            "removed": ConnectionStore.removed,
            "remindersEnabled": reminders.preferences.enabled,
            "leadTime": reminders.preferences.leadTime.rawValue,
            "permission": reminders.permissionState.rawValue,
            "scheduledCount": reminders.scheduledCount,
        ]
        if let pairing = ConnectionStore.pairing {
            result["server"] = pairing.server.absoluteString
            result["deviceName"] = pairing.deviceName
        }
        if let snapshot {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            result["snapshot"] = try JSONSerialization.jsonObject(with: encoder.encode(snapshot))
        }
        return String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)
    }

    private func begin() throws {
        guard !busy else { throw failure("İşlem sürüyor. Lütfen tamamlanmasını bekleyin.") }
        busy = true
    }

    /// Pairing is user-initiated (often straight from a QR scan, while the foreground refresh
    /// is still running), so wait for the in-flight operation instead of failing immediately.
    private func beginWaiting(timeout: TimeInterval = 15) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while busy && Date() < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        try begin()
    }

    func pair(server: String, code: String) async throws -> String {
        try await beginWaiting()
        defer { busy = false }
        guard let url = URL(string: server), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
            throw failure("Geçerli bir HTTPS sunucu adresi kullanın.")
        }
        let cleaned = code.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        guard cleaned.count == 8 else { throw failure("Eşleştirme kodu 8 karakter olmalı.") }
        let previous = ConnectionStore.pairing
        let paired = try await WidgetAPI.pair(server: url, code: cleaned, name: UIDevice.current.model)
        do { try ConnectionStore.savePairing(paired) }
        catch {
            await WidgetAPI.unpair(paired)
            throw error
        }
        ConnectionStore.snapshot = nil
        await reminders.sync(events: [])
        WidgetCenter.shared.reloadAllTimelines()
        if let previous { await WidgetAPI.unpair(previous) }
        return try await state()
    }

    func refresh() async throws -> String {
        try begin()
        defer { busy = false }
        guard let pairing = ConnectionStore.pairing else {
            await reminders.sync(events: [])
            return try await state()
        }
        do {
            let snapshot = try await WidgetAPI.summary(for: pairing)
            guard ConnectionStore.pairing == pairing else { return try await state() }
            ConnectionStore.snapshot = snapshot
            await reminders.sync(events: snapshot.upcomingEvents)
        } catch WidgetAPIError.unpaired {
            ConnectionStore.forget(removedByServer: true)
            await reminders.sync(events: [])
        }
        WidgetCenter.shared.reloadAllTimelines()
        return try await state()
    }

    func unpair() async throws -> String {
        try begin()
        defer { busy = false }
        let previous = ConnectionStore.pairing
        ConnectionStore.forget(removedByServer: false)
        await reminders.disableAll()
        WidgetCenter.shared.reloadAllTimelines()
        if let previous { await WidgetAPI.unpair(previous) }
        return try await state()
    }

    func setReminders(enabled: Bool, leadTime: String) async throws -> String {
        try begin()
        defer { busy = false }
        guard let lead = ReminderLeadTime(rawValue: leadTime) else { throw failure("Hatırlatma zamanı geçersiz.") }
        if enabled {
            guard ConnectionStore.pairing != nil else { throw failure("Önce web uygulamasıyla eşleştirin.") }
            let permission = await reminders.requestPermission()
            guard permission.allowsDelivery else { throw failure("Bildirim izni kapalı. iPhone Ayarlar'dan izin verin.") }
        }
        reminders.preferences.enabled = enabled
        reminders.preferences.leadTime = lead
        await reminders.sync(events: ConnectionStore.snapshot?.upcomingEvents ?? [])
        return try await state()
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "HisseCompanion", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
