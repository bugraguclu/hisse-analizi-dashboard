import React, { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { companion, type CompanionState, type ReminderLeadTime } from "../lib/companion";
import { Spacing, useThemeColors } from "../lib/theme";

const DEFAULT_SERVER = "https://hisse-analizi.duckdns.org";
const LEAD_TIMES: Array<[ReminderLeadTime, string]> = [["minutes15", "15 dk önce"], ["hour1", "1 saat önce"], ["dayBeforeMorning", "1 gün önce (09:00)"]];

export default function CompanionScreen() {
  const params = useLocalSearchParams<{ server?: string; code?: string; eventId?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [server, setServer] = useState(params.server ?? DEFAULT_SERVER);
  const [code, setCode] = useState(params.code ?? "");
  const [state, setState] = useState<CompanionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (params.server) setServer(params.server);
    if (params.code) setCode(params.code);
  }, [params.code, params.server]);
  useEffect(() => {
    let active = true;
    if (companion.available) void companion.state().then((next) => { if (active) setState(next); }).catch((err: unknown) => { if (active) setError(String(err)); });
    return () => { active = false; };
  }, []);

  const run = useCallback(async (action: () => Promise<CompanionState>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { setState(await action()); }
    catch (err) {
      setError(err instanceof Error ? err.message : "İşlem tamamlanamadı.");
      if (companion.available) {
        try { setState(await companion.state()); } catch { /* Keep the last readable state. */ }
      }
    }
    finally { setBusy(false); }
  }, [busy]);

  const connect = () => {
    const address = server.trim().replace(/\/+$/, "");
    let origin: string;
    try {
      const url = new URL(address);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
      origin = url.origin;
    } catch { setError("Geçerli bir HTTPS sunucu adresi girin."); return; }
    const proceed = () => void run(async () => {
      const paired = await companion.pair(address, code);
      setCode("");
      router.setParams({ code: "", server: "" });
      setState(paired);
      return companion.refresh();
    });
    // Always show the destination, including links received through the iPhone Camera.
    Alert.alert("Widget bağlantısı", `${origin} sunucusundaki takip listeniz bu iPhone'a bağlanacak.${state?.paired ? " Mevcut bağlantı değiştirilecek." : ""}`, [
      { text: "Vazgeç", style: "cancel" }, { text: "Bağlan", onPress: proceed },
    ]);
  };
  const button = (label: string, onPress: () => void, destructive = false) => (
    <TouchableOpacity key={label} disabled={busy} accessibilityRole="button" onPress={onPress} style={[styles.button, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}>
      <Text style={{ color: destructive ? colors.down : colors.accent, fontWeight: "600" }}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <ScrollView style={{ backgroundColor: colors.bgPrimary }} contentContainerStyle={{ padding: Spacing.lg, paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.lg }} keyboardShouldPersistTaps="handled">
      {button("Geri", () => router.back())}
      <Text style={[styles.title, { color: colors.textPrimary }]}>iPhone widget ve hatırlatıcılar</Text>
      <Text style={{ color: colors.textSecondary }}>Web'de Cihazlar sayfasından kod oluşturun. QR kodunu iPhone Kamerası ile açabilir veya aşağıya girebilirsiniz.</Text>
      {!companion.available && <Text style={{ color: colors.warn }}>Bu özellik Expo Go içinde çalışmaz; iOS uygulama derlemesi gerekir.</Text>}
      {error && <Text accessibilityRole="alert" style={{ color: colors.down }}>{error}</Text>}
      {state?.removed && <Text style={{ color: colors.warn }}>Web'den cihaz erişimi kaldırılmış. Yeni bir kodla eşleştirin.</Text>}
      {state?.paired && <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{state.snapshot?.watchlist.name || "Web takip listesi"}</Text>
        <Text style={{ color: colors.textMuted }}>{state.server}</Text>
        <Text style={{ color: colors.textMuted }}>{state.snapshot ? `Son veri: ${new Date(state.snapshot.fetched_at).toLocaleString("tr-TR")}${state.snapshot.stale ? " · Gecikmiş veri" : ""}` : "Henüz piyasa özeti alınmadı."}</Text>
        {state.snapshot?.watchlist.items.map((item) => <Text key={item.ticker} style={{ color: colors.textPrimary }}>{item.ticker} · {item.last ?? "—"}</Text>)}
        {button("Veriyi yenile", () => void run(companion.refresh))}
        {button("Bağlantıyı kaldır", () => Alert.alert("Bağlantı kaldırılsın mı?", "Widget verisi ve bu uygulamanın hatırlatıcıları temizlenecek.", [
          { text: "Vazgeç", style: "cancel" }, { text: "Kaldır", style: "destructive", onPress: () => void run(companion.unpair) },
        ]), true)}
      </View>}
      {state?.snapshot && state.snapshot.upcoming_events.length > 0 && <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>Yaklaşan olaylar</Text>
        {state.snapshot.upcoming_events.map((event) => <View key={event.id} style={{ gap: 4, paddingVertical: 8 }}>
          <Text style={{ color: params.eventId === event.id ? colors.accent : colors.textPrimary, fontWeight: params.eventId === event.id ? "700" : "400" }}>{event.title}</Text>
          <Text style={{ color: colors.textMuted }}>{new Date(event.scheduled_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</Text>
        </View>)}
      </View>}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{state?.paired ? "Yeni bağlantı" : "Web ile eşleştir"}</Text>
        <TextInput accessibilityLabel="Sunucu adresi" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} />
        <TextInput accessibilityLabel="Eşleştirme kodu" value={code} onChangeText={setCode} placeholder="ABCD-2345" placeholderTextColor={colors.textMuted} autoCapitalize="characters" autoCorrect={false} maxLength={9} editable={!busy} style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} />
        {button(busy ? "İşlem sürüyor…" : "Kodu kullan ve bağlan", connect)}
      </View>
      {state?.paired && <View style={[styles.section, { borderColor: colors.border }]}>
        <View style={styles.row}><Text style={{ color: colors.textPrimary }}>Takvim hatırlatıcıları</Text><Switch accessibilityLabel="Takvim hatırlatıcıları" disabled={busy} value={state.remindersEnabled} onValueChange={(enabled) => void run(() => companion.reminders(enabled, state.leadTime))} /></View>
        {LEAD_TIMES.map(([value, label]) => button(`${state.leadTime === value ? "✓ " : ""}${label}`, () => void run(() => companion.reminders(state.remindersEnabled, value))))}
        <Text style={{ color: colors.textMuted }}>{state.scheduledCount} planlı bildirim · Tarihler uygulama açılıp yenilendiğinde güncellenir.</Text>
        {state.permission === "denied" && button("Bildirim ayarlarını aç", () => void Linking.openSettings())}
        <Text style={{ color: colors.textSecondary }}>Ana ekrana widget eklemek için boş bir alana basılı tutun → Widget Ekle → Hisse Analizi. Siri kestirmeleri Kestirmeler uygulamasında Hisse Analizi altında bulunur.</Text>
      </View>}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 23, fontWeight: "700" }, section: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 12 },
  button: { padding: 12, minHeight: 44, borderWidth: 1, borderRadius: 8, alignItems: "center" },
  input: { padding: 12, borderWidth: 1, borderRadius: 8, fontSize: 16 }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
