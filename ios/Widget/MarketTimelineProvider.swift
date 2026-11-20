import Foundation
import WidgetKit

struct MarketWidgetEntry: TimelineEntry {
    enum State {
        case ready(MarketSnapshot, isOffline: Bool)
        case notPaired
        case removed
        case unavailable
    }

    let date: Date
    let state: State

    var isReady: Bool {
        if case .ready = state { return true }
        return false
    }
}

struct MarketTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> MarketWidgetEntry {
        MarketWidgetEntry(date: .now, state: .ready(.sample, isOffline: false))
    }

    func getSnapshot(in context: Context, completion: @escaping (MarketWidgetEntry) -> Void) {
        if context.isPreview {
            completion(MarketWidgetEntry(date: .now, state: .ready(ConnectionStore.snapshot ?? .sample, isOffline: false)))
            return
        }
        Task {
            completion(await Self.current())
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MarketWidgetEntry>) -> Void) {
        Task {
            let entry = await Self.current()
            let refresh: Date
            switch entry.state {
            case .ready(let snapshot, let isOffline):
                // ~15-minute refresh request during session (best-effort; iOS WidgetKit budgets actual wakeups).
                if isOffline || snapshot.stale {
                    refresh = Date.now.addingTimeInterval(5 * 60)
                } else {
                    refresh = Date.now.addingTimeInterval(15 * 60)
                }
            case .unavailable:
                refresh = Date.now.addingTimeInterval(5 * 60)
            case .notPaired, .removed:
                refresh = Date.now.addingTimeInterval(60 * 60)
            }
            completion(Timeline(entries: [entry], policy: .after(refresh)))
        }
    }

    static func current() async -> MarketWidgetEntry {
        guard let pairing = ConnectionStore.pairing else {
            return MarketWidgetEntry(date: .now, state: ConnectionStore.removed ? .removed : .notPaired)
        }
        do {
            let snapshot = try await WidgetAPI.summary(for: pairing)
            ConnectionStore.snapshot = snapshot
            return MarketWidgetEntry(date: .now, state: .ready(snapshot, isOffline: false))
        } catch WidgetAPIError.unpaired {
            ConnectionStore.forget(removedByServer: true)
            return MarketWidgetEntry(date: .now, state: .removed)
        } catch {
            // Offline or transient server failure: keep showing the last cached snapshot
            // with an explicit offline timestamp rather than blanking out the widget.
            if let cached = ConnectionStore.snapshot {
                return MarketWidgetEntry(date: .now, state: .ready(cached, isOffline: true))
            }
            return MarketWidgetEntry(date: .now, state: .unavailable)
        }
    }
}
