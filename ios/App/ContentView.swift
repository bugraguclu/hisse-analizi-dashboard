import SwiftUI
import UIKit

struct ContentView: View {
    @ObservedObject var model: ConnectionModel
    @ObservedObject var reminders: CalendarReminderManager
    @Environment(\.scenePhase) private var phase
    @Environment(\.openURL) private var openURL

    @State private var confirmUnpair = false
    @State private var activeShortcutSheet: ShortcutDefinition?
    @State private var shortcutStatusMessage: String?

    var body: some View {
        Group {
            if model.pairing != nil {
                pairedTabs
            } else {
                NavigationStack {
                    pairingForm
                        .navigationTitle("Hisse Analizi")
                }
            }
        }
        .tint(WidgetPalette.brand)
        .task {
            await reminders.refreshPermissionStatus()
            await model.refresh()
        }
        .onChange(of: phase) { _, next in
            if next == .active {
                Task {
                    await reminders.refreshPermissionStatus()
                    await model.refresh()
                }
            }
        }
        .sheet(
            isPresented: Binding(
                get: { model.focusedTicker != nil },
                set: { if !$0 { model.focusedTicker = nil } }
            )
        ) {
            if let ticker = model.focusedTicker {
                stockDetailSheet(ticker: ticker)
            }
        }
        .sheet(item: $model.focusedEvent) { event in
            eventDetailSheet(event: event)
        }
        .sheet(item: $activeShortcutSheet) { shortcut in
            AddToSiriSheet(shortcut: shortcut) { status in
                activeShortcutSheet = nil
                switch status {
                case "created":
                    shortcutStatusMessage = "“\(shortcut.phrase)” Siri kestirmesi eklendi."
                case "cancelled":
                    shortcutStatusMessage = nil
                default:
                    shortcutStatusMessage = "Bu cihazda Siri kestirmesi eklenemedi."
                }
            }
        }
    }

    // MARK: - Paired Tab Shell

    private var pairedTabs: some View {
        TabView(selection: $model.selectedTab) {
            NavigationStack {
                overviewTab
                    .navigationTitle("Piyasa Özeti")
            }
            .tabItem { Label("Özet", systemImage: "chart.line.uptrend.xyaxis") }
            .tag(AppTab.overview)

            NavigationStack {
                remindersTab
                    .navigationTitle("Hatırlatıcılar")
            }
            .tabItem { Label("Takvim", systemImage: "bell.badge") }
            .tag(AppTab.reminders)

            NavigationStack {
                shortcutsTab
                    .navigationTitle("Siri & Kestirmeler")
            }
            .tabItem { Label("Kestirmeler", systemImage: "sparkles") }
            .tag(AppTab.shortcuts)

            NavigationStack {
                connectionTab
                    .navigationTitle("Widget Bağlantısı")
            }
            .tabItem { Label("Bağlantı", systemImage: "iphone.radiowaves.left.and.right") }
            .tag(AppTab.connection)
        }
    }

    // MARK: - 1. Overview Tab (BIST 100 + Watchlist + Upcoming)

    private var overviewTab: some View {
        List {
            if let banner = model.routeBanner {
                Section {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "info.circle.fill")
                            .foregroundStyle(WidgetPalette.brand)
                        Text(banner)
                            .font(.footnote)
                        Spacer()
                        Button("Kapat") { model.routeBanner = nil }
                            .font(.caption.weight(.semibold))
                    }
                }
            }

            if let snapshot = model.snapshot {
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(snapshot.isSessionOpen && !model.isOffline ? WidgetPalette.positive : WidgetPalette.neutral)
                                    .frame(width: 8, height: 8)
                                Text("BIST 100 (XU100)")
                                    .font(.subheadline.weight(.semibold))
                            }
                            Text(snapshot.dataStampLabel(isOffline: model.isOffline))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(MarketFormat.index(snapshot.bist100.last))
                                .font(.system(.title3, design: .monospaced).weight(.bold))
                            Text(MarketFormat.percent(snapshot.bist100.changePercent))
                                .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                                .foregroundStyle(WidgetPalette.changeColor(snapshot.bist100.changePercent))
                        }
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Endeks")
                }

                Section {
                    ForEach(snapshot.watchlist.items) { stock in
                        Button {
                            model.focusedTicker = stock.ticker
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(stock.ticker)
                                        .font(.system(.body, design: .monospaced).weight(.semibold))
                                        .foregroundStyle(.primary)
                                    if let name = stock.name, !name.isEmpty {
                                        Text(name)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(MarketFormat.price(stock.last))
                                        .font(.system(.body, design: .monospaced).weight(.medium))
                                        .foregroundStyle(.primary)
                                    Text(MarketFormat.percent(stock.changePercent))
                                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                                        .foregroundStyle(WidgetPalette.changeColor(stock.changePercent))
                                }
                            }
                        }
                    }
                } header: {
                    Text(snapshot.watchlist.name.isEmpty ? "Takip Listesi" : snapshot.watchlist.name)
                }

                if !snapshot.upcomingEvents.isEmpty {
                    Section("Yaklaşan Olaylar") {
                        ForEach(snapshot.upcomingEvents.prefix(5)) { event in
                            Button {
                                model.focusedEvent = event
                            } label: {
                                eventRow(event)
                            }
                        }
                    }
                }
            } else if let message = model.message {
                Section {
                    Text(message).font(.footnote).foregroundStyle(.red)
                }
            } else {
                Section {
                    HStack {
                        ProgressView()
                        Text("Piyasa özeti yükleniyor…").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .refreshable {
            await model.refresh()
        }
    }

    // MARK: - 2. Calendar Reminders Tab (Item 16)

    private var remindersTab: some View {
        List {
            Section {
                Toggle("Yerel takvim hatırlatıcıları", isOn: Binding(
                    get: { reminders.preferences.enabled },
                    set: { enabled in
                        Task {
                            if enabled {
                                let status = await reminders.requestPermission()
                                reminders.preferences.enabled = status.allowsDelivery
                            } else {
                                reminders.preferences.enabled = false
                            }
                            await reminders.sync(events: model.snapshot?.upcomingEvents ?? [])
                        }
                    }
                ))

                HStack {
                    Text("Bildirim durumu")
                    Spacer()
                    Text(reminders.permissionState.labelTR)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if reminders.permissionState == .denied {
                    Button("iOS Bildirim Ayarlarını Aç") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    }
                }

                if reminders.preferences.enabled {
                    Picker("Hatırlatma zamanı", selection: Binding(
                        get: { reminders.preferences.leadTime },
                        set: { value in
                            reminders.preferences.leadTime = value
                            Task { await reminders.sync(events: model.snapshot?.upcomingEvents ?? []) }
                        }
                    )) {
                        ForEach(ReminderLeadTime.allCases) { lead in
                            Text(lead.labelTR).tag(lead)
                        }
                    }

                    HStack {
                        Text("Planlı yerel bildirim")
                        Spacer()
                        Text("\(reminders.scheduledCount) / \(CalendarReminderPlanner.maxOwnedNotifications)")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Bildirim Ayarları")
            } footer: {
                Text("Yerel hatırlatıcılar yalnızca bilinen bilanço, temettü ve ekonomik takvim tarihleri için çalışır; canlı fiyat eşiği veya anlık KAP push alarmı sağlamaz.")
            }

            if reminders.preferences.enabled {
                Section("Hatırlatılacak Türler") {
                    ForEach(CalendarEventKind.allCases, id: \.self) { kind in
                        Toggle(isOn: Binding(
                            get: { reminders.preferences.enabledKinds.contains(kind) },
                            set: { on in
                                if on {
                                    reminders.preferences.enabledKinds.insert(kind)
                                } else {
                                    reminders.preferences.enabledKinds.remove(kind)
                                }
                                Task { await reminders.sync(events: model.snapshot?.upcomingEvents ?? []) }
                            }
                        )) {
                            Label(kind.labelTR, systemImage: kind.systemImage)
                        }
                    }
                }
            }

            Section("Yaklaşan Takvim") {
                let events = model.snapshot?.upcomingEvents ?? []
                if events.isEmpty {
                    Text("Kayıtlı yaklaşan bilanço, temettü veya PPK olayı yok.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(events) { event in
                        let muted = reminders.preferences.mutedEventIds.contains(event.id)
                        HStack(spacing: 12) {
                            Button {
                                model.focusedEvent = event
                            } label: {
                                eventRow(event)
                            }
                            if reminders.preferences.enabled && reminders.preferences.enabledKinds.contains(event.kind) {
                                Button {
                                    if muted {
                                        reminders.preferences.mutedEventIds.remove(event.id)
                                    } else {
                                        reminders.preferences.mutedEventIds.insert(event.id)
                                    }
                                    Task { await reminders.sync(events: events) }
                                } label: {
                                    Image(systemName: muted ? "bell.slash" : "bell.fill")
                                        .foregroundStyle(muted ? .secondary : WidgetPalette.brand)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(muted ? "Hatırlatıcıyı aç" : "Hatırlatıcıyı kapat")
                            }
                        }
                    }
                }
            }
        }
        .refreshable {
            await model.refresh()
        }
    }

    // MARK: - 3. Siri / Shortcuts Tab (Item 21)

    private var shortcutsTab: some View {
        let watchlistId = model.snapshot?.watchlist.id ?? "favorites"
        let watchlistName = model.snapshot?.watchlist.name.isEmpty == false ? (model.snapshot?.watchlist.name ?? "Favoriler") : "Favoriler"
        let dashboardId = model.snapshot?.dashboardId ?? "home"
        let stocks = model.snapshot?.watchlist.items ?? []

        var definitions: [ShortcutDefinition] = [
            ShortcutDefinition(
                id: "dashboard-\(dashboardId)",
                title: "Sabah panomu aç",
                subtitle: "BIST 100 özeti ve günlük takip ekranı",
                phrase: "Sabah panomu aç",
                route: .dashboard(id: dashboardId),
                systemImage: "sun.max"
            ),
            ShortcutDefinition(
                id: "watchlist-\(watchlistId)",
                title: "\(watchlistName) takip listemi aç",
                subtitle: "Bağlı kişisel takip listesine doğrudan geç",
                phrase: "Takip listemi aç",
                route: .watchlist(id: watchlistId),
                systemImage: "star.fill"
            ),
        ]

        for stock in stocks.prefix(6) {
            definitions.append(
                ShortcutDefinition(
                    id: "stock-\(stock.ticker)",
                    title: "\(stock.ticker) analizini aç",
                    subtitle: stock.name ?? "Hisse özeti ve web analiz bağlantısı",
                    phrase: "\(stock.ticker) analizini aç",
                    route: .stock(ticker: stock.ticker, tab: nil),
                    systemImage: "chart.bar"
                )
            )
        }

        return List {
            if let status = shortcutStatusMessage {
                Section {
                    Text(status).font(.footnote).foregroundStyle(WidgetPalette.brand)
                }
            }

            Section {
                ForEach(definitions) { item in
                    HStack(spacing: 12) {
                        Image(systemName: item.systemImage)
                            .foregroundStyle(WidgetPalette.brand)
                            .frame(width: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(.subheadline.weight(.medium))
                            Text(item.subtitle).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Siri'ye Ekle") {
                            activeShortcutSheet = item
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            } header: {
                Text("Kişisel Kestirmeler")
            } footer: {
                Text("Kestirmeler uygulama kapalıyken de ilgili ekranı açar. Apple Kestirmeler uygulamasında “Hisse Analizi” eylemleri doğrudan kullanılabilir.")
            }
        }
    }

    // MARK: - 4. Connection / Pairing Tab (Item 18)

    private var connectionTab: some View {
        List {
            if let pairing = model.pairing {
                Section("Bağlı Sunucu") {
                    LabeledContent("Sunucu", value: pairing.server.absoluteString)
                    LabeledContent("Cihaz", value: pairing.deviceName)
                    LabeledContent("Yetki", value: "Salt okunur widget (widget:read)")
                    if let snapshot = model.snapshot {
                        LabeledContent("Son veri", value: snapshot.dataStampLabel(isOffline: model.isOffline))
                    }
                }

                Section("Ana Ekran ve Kilit Ekranı Widget'ları") {
                    Text("Ana ekranda boş bir alana basılı tut, sol üstten Araç Takımı Ekle'yi seç ve “Hisse Analizi”ni ara. BIST Özeti, Takip Listesi ve Yaklaşan Olaylar widget'ları ana ekran ve kilit ekranında çalışır.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("Widget'lar yaklaşık 15 dakikada bir yenileme ister; kesin yenileme zamanı iOS tarafından belirlenir. İnternet yokken son kayıtlı veri tarih bilgisiyle gösterilir.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    if let url = model.webURL(path: "/cihazlar") {
                        Button("Web'de cihaz ayarlarını aç") { openURL(url) }
                    }
                    Button("Şimdi yenile") { Task { await model.refresh() } }
                    Button("Bağlantıyı kaldır", role: .destructive) { confirmUnpair = true }
                        .confirmationDialog(
                            "Bu iPhone'un bağlantısı kaldırılsın mı?",
                            isPresented: $confirmUnpair,
                            titleVisibility: .visible
                        ) {
                            Button("Bağlantıyı kaldır", role: .destructive) {
                                Task {
                                    await reminders.disableAll()
                                    await model.unpair()
                                }
                            }
                        } message: {
                            Text("Widget kişisel veriye erişmeyi bırakır ve yerel hatırlatıcılar temizlenir. Yeniden bağlamak için yeni QR kodu gerekir.")
                        }
                }
            }
        }
    }

    // MARK: - Pairing Form (Unpaired State)

    private var pairingForm: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("iPhone Widget'ını Bağla")
                        .font(.title2.weight(.semibold))
                    Text("Hisse Analizi web uygulamasında Takip Listesi → iPhone Widget (veya /cihazlar) ekranından bağlantı kodu oluşturup QR kodu iPhone kamerasıyla okutun. Kamerayı kullanamıyorsanız kodu aşağıya yazın.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if model.removed {
                    Text(WidgetAPIError.unpaired.errorDescription ?? "")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                }

                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Sunucu").font(.footnote.weight(.medium)).foregroundStyle(.secondary)
                        TextField("https://…", text: $model.server)
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("8 Karakterlik Kod").font(.footnote.weight(.medium)).foregroundStyle(.secondary)
                        TextField("ABCD-2345", text: $model.code)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.system(.title3, design: .monospaced))
                            .onSubmit { Task { await model.pair() } }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    }
                }

                if let message = model.message {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await model.pair() }
                } label: {
                    ZStack {
                        Text("Bağla").opacity(model.busy ? 0 : 1)
                        if model.busy { ProgressView().tint(.white) }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(model.busy)
            }
            .padding(20)
        }
    }

    // MARK: - Helpers & Detail Sheets

    private func eventRow(_ event: CalendarEventItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: event.kind.systemImage)
                .foregroundStyle(WidgetPalette.brand)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                if let subtitle = event.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(MarketFormat.shortDateTime(event.scheduledAt))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    private func stockDetailSheet(ticker: String) -> some View {
        let quote = model.snapshot?.watchlist.items.first { $0.ticker == ticker }
        return NavigationStack {
            List {
                Section("Fiyat Özeti") {
                    LabeledContent("Hisse", value: ticker)
                    if let name = quote?.name {
                        LabeledContent("Şirket", value: name)
                    }
                    LabeledContent("Son Fiyat", value: MarketFormat.price(quote?.last))
                    LabeledContent("Günlük Değişim", value: MarketFormat.percent(quote?.changePercent))
                    if let snapshot = model.snapshot {
                        LabeledContent("Veri Zamanı", value: snapshot.dataStampLabel(isOffline: model.isOffline))
                    }
                }
                Section("Hızlı İşlemler") {
                    if let url = model.webURL(path: "/hisse/\(ticker)") {
                        Button("Web analizini aç") { openURL(url) }
                    }
                    Button("“\(ticker) analizini aç” Siri kestirmesi ekle") {
                        model.focusedTicker = nil
                        activeShortcutSheet = ShortcutDefinition(
                            id: "stock-\(ticker)",
                            title: "\(ticker) analizini aç",
                            subtitle: quote?.name ?? ticker,
                            phrase: "\(ticker) analizini aç",
                            route: .stock(ticker: ticker, tab: nil),
                            systemImage: "chart.bar"
                        )
                    }
                }
            }
            .navigationTitle(ticker)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Kapat") { model.focusedTicker = nil }
                }
            }
        }
    }

    private func eventDetailSheet(event: CalendarEventItem) -> some View {
        NavigationStack {
            List {
                Section("Olay Bilgisi") {
                    LabeledContent("Tür", value: event.kind.labelTR)
                    LabeledContent("Başlık", value: event.title)
                    if let subtitle = event.subtitle {
                        LabeledContent("Detay", value: subtitle)
                    }
                    LabeledContent("Tarih", value: MarketFormat.shortDateTime(event.scheduledAt))
                    if let ticker = event.ticker {
                        LabeledContent("Hisse", value: ticker)
                    }
                }
                Section {
                    if let ticker = event.ticker, let url = model.webURL(path: "/hisse/\(ticker)") {
                        Button("\(ticker) sayfasını web'de aç") { openURL(url) }
                    } else if let url = model.webURL(path: "/makro") {
                        Button("Ekonomik takvimi web'de aç") { openURL(url) }
                    }
                }
            }
            .navigationTitle(event.kind.labelTR)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Kapat") { model.focusedEvent = nil }
                }
            }
        }
    }
}
