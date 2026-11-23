import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { dropIndex } from "../lib/reorder";
import { FontSize, useThemeColors } from "../lib/theme";
import { haptic, Icon, type IconName } from "./ui";

// ---------------------------------------------------------------------------
// Drag to reorder
// ---------------------------------------------------------------------------

export interface DragControls {
  index: number;
  /** This row is lifted and following the finger. */
  isActive: boolean;
  /** Some row in the list is lifted. */
  isDragging: boolean;
  /** Lift the row; the next finger movement drags it. Call from onLongPress or a grip's onPressIn. */
  lift: () => void;
  /** Put the row back if the finger lifted without moving. Call from onPressOut. */
  drop: () => void;
}

/**
 * Drag-to-reorder list built on PanResponder, so it needs no extra native
 * module. Rows are lifted by `lift()` (long press or grip), follow the finger,
 * and the rows they pass slide out of the way. Rows may differ in height.
 *
 * The parent should stop scrolling while a row is lifted (`onDragActiveChange`).
 */
export function ReorderableList<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  onDragActiveChange,
  style,
}: {
  data: readonly T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, controls: DragControls) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
  onDragActiveChange?: (active: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const keys = useMemo(() => data.map(keyExtractor), [data, keyExtractor]);
  const layouts = useRef(new Map<string, { y: number; height: number }>()).current;
  const offsets = useRef(new Map<string, Animated.Value>()).current;
  const targets = useRef(new Map<string, number>()).current;
  const lift = useRef(new Animated.Value(0)).current;
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const live = useRef({
    keys,
    armed: null as string | null,
    dragging: false,
    settling: false,
    from: -1,
    to: -1,
    onReorder,
    onDragActiveChange,
  });
  live.current.keys = keys;
  live.current.onReorder = onReorder;
  live.current.onDragActiveChange = onDragActiveChange;

  const offsetFor = useCallback(
    (key: string) => {
      let value = offsets.get(key);
      if (!value) {
        value = new Animated.Value(0);
        offsets.set(key, value);
      }
      return value;
    },
    [offsets],
  );

  const reset = useCallback(() => {
    const state = live.current;
    for (const value of offsets.values()) value.setValue(0);
    targets.clear();
    lift.setValue(0);
    const wasActive = state.armed !== null;
    state.armed = null;
    state.dragging = false;
    state.settling = false;
    state.from = -1;
    state.to = -1;
    setActiveKey(null);
    if (wasActive) state.onDragActiveChange?.(false);
  }, [lift, offsets, targets]);

  const arm = useCallback(
    (key: string) => {
      const state = live.current;
      if (state.armed !== null || state.settling) return;
      const from = state.keys.indexOf(key);
      if (from < 0) return;
      state.armed = key;
      state.from = from;
      state.to = from;
      setActiveKey(key);
      haptic.medium();
      Animated.spring(lift, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
      state.onDragActiveChange?.(true);
    },
    [lift],
  );

  const disarm = useCallback(() => {
    const state = live.current;
    if (state.armed === null || state.dragging || state.settling) return;
    reset();
  }, [reset]);

  const heights = () => live.current.keys.map((k) => layouts.get(k) ?? { y: 0, height: 0 });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: () => {
          const state = live.current;
          if (state.armed === null || state.settling) return false;
          state.dragging = true;
          return true;
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderMove: (_event, gesture) => {
          const state = live.current;
          if (state.armed === null) return;
          const boxes = heights();
          const own = boxes[state.from];
          const last = boxes[boxes.length - 1];
          // Keep the lifted row inside the list.
          const dy = own && last
            ? Math.max(-own.y, Math.min(gesture.dy, last.y + last.height - own.y - own.height))
            : gesture.dy;
          offsetFor(state.armed).setValue(dy);
          const to = dropIndex(boxes, state.from, dy);
          if (to === state.to) return;
          state.to = to;
          haptic.selection();
          const shift = boxes[state.from]?.height ?? 0;
          state.keys.forEach((key, i) => {
            if (i === state.from) return;
            const target = state.from < i && i <= to ? -shift : to <= i && i < state.from ? shift : 0;
            if (targets.get(key) === target) return;
            targets.set(key, target);
            Animated.spring(offsetFor(key), {
              toValue: target,
              useNativeDriver: true,
              speed: 26,
              bounciness: 0,
            }).start();
          });
        },
        onPanResponderRelease: () => finish(),
        onPanResponderTerminate: () => finish(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function finish() {
    const state = live.current;
    if (state.armed === null) return;
    const { from, to, armed } = state;
    const boxes = heights();
    let settle = 0;
    if (to > from) for (let i = from + 1; i <= to; i += 1) settle += boxes[i].height;
    if (to < from) for (let i = to; i < from; i += 1) settle -= boxes[i].height;
    state.settling = true;
    Animated.parallel([
      Animated.spring(offsetFor(armed), { toValue: settle, useNativeDriver: true, speed: 26, bounciness: 2 }),
      Animated.timing(lift, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      if (to !== from) {
        haptic.light();
        pendingReset.current = true;
        state.onReorder(from, to);
      } else {
        reset();
      }
    });
  }

  // After the parent commits the new order, rows are already in their new
  // slots: clear every offset in the same frame so nothing jumps.
  const pendingReset = useRef(false);
  const signature = keys.join("|");
  useLayoutEffect(() => {
    if (!pendingReset.current) return;
    pendingReset.current = false;
    reset();
  }, [signature, reset]);

  const isDragging = activeKey !== null;
  const scale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });

  return (
    <View style={style} {...responder.panHandlers}>
      {data.map((item, index) => {
        const key = keys[index];
        const isActive = key === activeKey;
        return (
          <Animated.View
            key={key}
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              layouts.set(key, { y, height });
            }}
            style={[
              {
                zIndex: isActive ? 10 : 0,
                transform: isActive
                  ? [{ translateY: offsetFor(key) }, { scale }]
                  : [{ translateY: offsetFor(key) }],
              },
              isActive
                ? [
                    styles.lifted,
                    { backgroundColor: colors.bgCard },
                  ]
                : null,
            ]}
          >
            {renderItem(item, {
              index,
              isActive,
              isDragging,
              lift: () => arm(key),
              drop: disarm,
            })}
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Three-line grip shown in edit mode; touching it lifts the row at once. */
export function DragGrip({ controls, label }: { controls: DragControls; label: string }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPressIn={controls.lift}
      onPressOut={controls.drop}
      hitSlop={12}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Sürükleyerek sırasını değiştir"
      style={styles.grip}
    >
      <Icon name="line.3.horizontal" size={17} color={colors.textMuted} weight="medium" />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Swipe actions
// ---------------------------------------------------------------------------

export interface SwipeAction {
  label: string;
  icon: IconName;
  color: string;
  onPress: () => void;
}

const ACTION_WIDTH = 78;
let closeOpenRow: (() => void) | null = null;

/**
 * iOS Mail-style swipe row. Swipe left reveals `trailing` actions; a long
 * swipe runs the first one. Swipe right runs `leading` once past a threshold.
 */
export function SwipeRow({
  children,
  trailing = [],
  leading,
  enabled = true,
}: {
  children: React.ReactNode;
  trailing?: SwipeAction[];
  leading?: SwipeAction;
  enabled?: boolean;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"left" | "right" | null>(null);
  const live = useRef({ base: 0, width: 0, armedFull: false, armedLeading: false, enabled, trailing, leading });
  live.current.enabled = enabled;
  live.current.trailing = trailing;
  live.current.leading = leading;

  const springTo = useCallback(
    (toValue: number, done?: () => void) => {
      Animated.spring(x, { toValue, useNativeDriver: true, speed: 22, bounciness: 0 }).start(() => done?.());
    },
    [x],
  );

  const close = useCallback(() => {
    live.current.base = 0;
    setOpen(false);
    springTo(0, () => setSide(null));
    if (closeOpenRow === close) closeOpenRow = null;
  }, [springTo]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, g) => {
          const state = live.current;
          if (!state.enabled) return false;
          return Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
          live.current.armedFull = false;
          live.current.armedLeading = false;
        },
        onPanResponderMove: (_event, g) => {
          const state = live.current;
          const reveal = state.trailing.length * ACTION_WIDTH;
          let next = state.base + g.dx;
          if (next > 0 && !state.leading) next = next * 0.15;
          if (next < -reveal) next = -reveal + (next + reveal) * (state.trailing.length > 0 ? 0.6 : 0.15);
          setSide(next < 0 ? "right" : next > 0 ? "left" : null);
          x.setValue(next);

          const full = state.width * 0.55;
          const wantsFull = state.trailing.length > 0 && next < -full;
          if (wantsFull !== state.armedFull) {
            state.armedFull = wantsFull;
            haptic.light();
          }
          const wantsLeading = Boolean(state.leading) && next > 84;
          if (wantsLeading !== state.armedLeading) {
            state.armedLeading = wantsLeading;
            haptic.light();
          }
        },
        onPanResponderRelease: (_event, g) => {
          const state = live.current;
          const reveal = state.trailing.length * ACTION_WIDTH;
          const next = state.base + g.dx;
          if (state.armedLeading && state.leading) {
            const action = state.leading;
            close();
            action.onPress();
            return;
          }
          if (state.armedFull && state.trailing[0]) {
            const action = state.trailing[0];
            Animated.timing(x, { toValue: -state.width, duration: 180, useNativeDriver: true }).start(() => {
              action.onPress();
              x.setValue(0);
              state.base = 0;
              setOpen(false);
              setSide(null);
            });
            return;
          }
          if (reveal > 0 && (next < -reveal / 2 || g.vx < -0.6)) {
            state.base = -reveal;
            setOpen(true);
            closeOpenRow = close;
            springTo(-reveal);
          } else {
            close();
          }
        },
        onPanResponderTerminate: () => close(),
      }),
    [close, springTo, x],
  );

  return (
    <View
      style={styles.swipeWrap}
      onLayout={(event) => {
        live.current.width = event.nativeEvent.layout.width;
      }}
    >
      {side === "right" && trailing.length > 0 ? (
        <View style={[styles.trailingActions, { backgroundColor: trailing[0].color }]}>
          {trailing.map((action) => (
            <Pressable
              key={action.label}
              onPress={() => {
                close();
                action.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={[
                styles.action,
                { width: ACTION_WIDTH, backgroundColor: action.color },
              ]}
            >
              <Icon name={action.icon} size={18} color="#fff" weight="semibold" />
              <Text style={styles.actionLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {side === "left" && leading ? (
        <View style={[styles.leadingAction, { backgroundColor: leading.color }]}>
          <Icon name={leading.icon} size={18} color="#fff" weight="semibold" />
          <Text style={styles.actionLabel}>{leading.label}</Text>
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...responder.panHandlers}>
        {children}
        {open ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Eylemleri kapat" />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  lifted: {
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  grip: { paddingLeft: 4, paddingVertical: 6, justifyContent: "center" },
  swipeWrap: { overflow: "hidden" },
  trailingActions: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: "row-reverse",
    justifyContent: "flex-start",
  },
  leadingAction: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingLeft: 22,
    gap: 3,
  },
  action: { alignItems: "center", justifyContent: "center", gap: 3 },
  actionLabel: { color: "#fff", fontSize: FontSize.xs, fontWeight: "600" },
});
