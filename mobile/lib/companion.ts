import { requireOptionalNativeModule } from "expo";

export type ReminderLeadTime = "minutes15" | "hour1" | "dayBeforeMorning";
export interface CompanionState {
  paired: boolean;
  removed: boolean;
  server?: string;
  deviceName?: string;
  remindersEnabled: boolean;
  leadTime: ReminderLeadTime;
  permission: string;
  scheduledCount: number;
  snapshot?: {
    fetched_at: string;
    stale: boolean;
    watchlist: { id: string; name: string; items: Array<{ ticker: string; last: number | null }> };
    upcoming_events: Array<{ id: string; title: string; scheduled_at: string }>;
  };
}
interface NativeCompanion {
  getState(): Promise<string>;
  pair(server: string, code: string): Promise<string>;
  refresh(): Promise<string>;
  unpair(): Promise<string>;
  setReminders(enabled: boolean, leadTime: string): Promise<string>;
  consumeShortcut(): Promise<string | null>;
  addListener(name: string, listener: () => void): { remove(): void };
}

const native = requireOptionalNativeModule<NativeCompanion>("HisseCompanion");
function required(): NativeCompanion {
  if (!native) throw new Error("Widget bağlantısı için uygulamanın iOS derlemesini kullanın.");
  return native;
}
const decode = async (result: Promise<string>): Promise<CompanionState> => JSON.parse(await result) as CompanionState;
export const companion = {
  available: Boolean(native),
  state: () => decode(required().getState()),
  pair: (server: string, code: string) => decode(required().pair(server, code)),
  refresh: () => decode(required().refresh()),
  unpair: () => decode(required().unpair()),
  reminders: (enabled: boolean, leadTime: ReminderLeadTime) => decode(required().setReminders(enabled, leadTime)),
  consumeShortcut: () => native?.consumeShortcut() ?? Promise.resolve(null),
  subscribeShortcut: (listener: () => void) => native?.addListener("onShortcut", listener),
};
