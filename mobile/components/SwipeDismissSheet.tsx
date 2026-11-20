import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  type LayoutChangeEvent,
  PanResponder,
  type PanResponderGestureState,
  Platform,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { clampSheetOffset, isDownwardSheetPull, shouldCompleteSheetDismiss } from "../lib/sheetPhysics";
import { FontSize, MotionEasing, MotionSpring, Spacing, useThemeColors } from "../lib/theme";

const NATIVE_DRIVER = Platform.OS !== "web";

export interface SwipeDismissSheetProps {
  active?: boolean;
  accessibilityViewIsModal?: boolean;
  children: React.ReactNode;
  enabled?: boolean;
  onDismiss: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  position?: Animated.Value;
  style?: StyleProp<ViewStyle>;
  title?: string;
  subtitle?: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
}

interface SheetDragGate {
  exclude: () => void;
}

const SheetDragContext = createContext<SheetDragGate | null>(null);

/**
 * Shared iOS bottom-sheet surface (adapted from TusAnkiM's `SwipeDismissSheet.tsx`).
 *
 * - Single stable `PanResponder` reading live refs so re-renders mid-drag never drop the sheet.
 * - `SheetScrollView` automatically yields touches to inner scrolling when content overflows.
 * - `SheetNoDrag` excludes text inputs and interactive controls from pull-to-dismiss.
 */
export default function SwipeDismissSheet({
  active = true,
  accessibilityViewIsModal = true,
  children,
  enabled = true,
  onDismiss,
  onLayout,
  position,
  style,
  title,
  subtitle,
  headerLeft,
  headerRight,
}: SwipeDismissSheetProps) {
  const { height } = useWindowDimensions();
  const colors = useThemeColors();
  const ownTranslateY = useRef(new Animated.Value(0)).current;
  const translateY = position ?? ownTranslateY;
  const dismissing = useRef(false);
  const excludedTouch = useRef(false);
  const dragStart = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    if (!active) return;
    dismissing.current = false;
    if (position) return;
    translateY.stopAnimation();
    translateY.setValue(0);
  }, [active, position, translateY]);

  const dismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    Keyboard.dismiss();
    Animated.timing(translateY, {
      toValue: Math.max(height, 600),
      duration: 180,
      easing: MotionEasing.out,
      useNativeDriver: NATIVE_DRIVER,
    }).start(() => onDismiss());
  }, [height, onDismiss, translateY]);

  const gate = useMemo<SheetDragGate>(
    () => ({
      exclude: () => {
        excludedTouch.current = true;
      },
    }),
    [],
  );

  const live = useRef({ dismiss, enabled });
  live.current = { dismiss, enabled };

  const panResponder = useMemo(() => {
    const settle = () => {
      Animated.spring(translateY, {
        toValue: 0,
        ...MotionSpring.snap,
        useNativeDriver: NATIVE_DRIVER,
      }).start();
    };
    const pullsDown = (gesture: PanResponderGestureState) =>
      isDownwardSheetPull(gesture.dx, gesture.dy);

    return PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        excludedTouch.current = false;
        return false;
      },
      onStartShouldSetPanResponder: () => live.current.enabled && !excludedTouch.current,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        live.current.enabled && !excludedTouch.current && pullsDown(gesture),
      onPanResponderGrant: () => {
        dragging.current = false;
      },
      onPanResponderMove: (_event, gesture) => {
        if (!dragging.current) {
          if (!pullsDown(gesture)) return;
          dragging.current = true;
          dragStart.current = gesture.dy;
        }
        translateY.setValue(clampSheetOffset(gesture.dy, dragStart.current));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (!dragging.current) return;
        dragging.current = false;
        const distance = gesture.dy - dragStart.current;
        if (shouldCompleteSheetDismiss(distance, gesture.vy)) {
          live.current.dismiss();
          return;
        }
        settle();
      },
      onPanResponderTerminate: () => {
        if (!dragging.current) return;
        dragging.current = false;
        settle();
      },
      onPanResponderTerminationRequest: () => !dragging.current,
    });
  }, [translateY]);

  const hasHeader = Boolean(title || subtitle || headerLeft || headerRight);
  const hasSides = Boolean(headerLeft || headerRight);

  return (
    <SheetDragContext.Provider value={gate}>
      <Animated.View
        style={[
          styles.surface,
          { backgroundColor: colors.bgCard, borderColor: colors.border },
          style,
          { transform: [{ translateY }] },
        ]}
        accessibilityViewIsModal={accessibilityViewIsModal}
        onAccessibilityEscape={enabled ? dismiss : undefined}
        onLayout={onLayout}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.grabberButton}
          onPress={dismiss}
          disabled={!enabled}
          accessibilityRole="button"
          accessibilityLabel="Paneli kapat"
          accessibilityHint="Dokunun veya aşağı sürükleyin"
        >
          <View
            style={[
              styles.grabber,
              { backgroundColor: colors.border },
              !enabled && styles.grabberLocked,
            ]}
          />
        </TouchableOpacity>
        {hasHeader ? (
          <View style={[styles.header, hasSides && styles.headerWithSides]}>
            {hasSides ? <View style={[styles.side, styles.sideStart]}>{headerLeft}</View> : null}
            <View style={styles.headerCopy}>
              {title ? (
                <Text
                  style={[styles.title, { color: colors.textPrimary }]}
                  accessibilityRole="header"
                  numberOfLines={2}
                >
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {hasSides ? <View style={[styles.side, styles.sideEnd]}>{headerRight}</View> : null}
          </View>
        ) : null}
        {children}
      </Animated.View>
    </SheetDragContext.Provider>
  );
}

/**
 * Scrollable body inside a bottom sheet: owns vertical drags whenever content overflows so
 * scrolling a long filter form never triggers sheet dismissal.
 */
export const SheetScrollView = forwardRef<React.ComponentRef<typeof ScrollView>, ScrollViewProps>(function SheetScrollView(
  props,
  ref,
) {
  const gate = useContext(SheetDragContext);
  if (!gate) return <ScrollView ref={ref} {...props} />;
  return <SheetScrollArea ref={ref} gate={gate} {...props} />;
});

const SheetScrollArea = forwardRef<React.ComponentRef<typeof ScrollView>, ScrollViewProps & { gate: SheetDragGate }>(
  function SheetScrollArea(
    { gate, onLayout, onContentSizeChange, onScroll, scrollEnabled = true, scrollEventThrottle = 16, ...props },
    ref,
  ) {
    const colors = useThemeColors();
    const [viewportHeight, setViewportHeight] = useState(0);
    const [contentHeight, setContentHeight] = useState(0);
    const [scrolledUnder, setScrolledUnder] = useState(false);

    const overflows = viewportHeight === 0 || contentHeight > viewportHeight + 1;
    const scrolls = scrollEnabled && overflows;

    return (
      <View
        style={styles.scrollArea}
        onStartShouldSetResponderCapture={() => {
          if (scrolls) gate.exclude();
          return false;
        }}
      >
        <ScrollView
          ref={ref}
          {...props}
          scrollEnabled={scrolls}
          scrollEventThrottle={scrollEventThrottle}
          keyboardShouldPersistTaps="handled"
          onLayout={(event) => {
            setViewportHeight(event.nativeEvent.layout.height);
            onLayout?.(event);
          }}
          onContentSizeChange={(width, height) => {
            setContentHeight(height);
            onContentSizeChange?.(width, height);
          }}
          onScroll={(event) => {
            const under = event.nativeEvent.contentOffset.y > 0.5;
            setScrolledUnder((current) => (current === under ? current : under));
            onScroll?.(event);
          }}
        />
        {scrolls && scrolledUnder ? (
          <View style={[styles.scrollEdge, { backgroundColor: colors.border }]} />
        ) : null}
      </View>
    );
  },
);

/** Wraps text fields or sliders inside a sheet so dragging on them never drags the sheet. */
export function SheetNoDrag({ onStartShouldSetResponderCapture, ...props }: ViewProps) {
  const gate = useContext(SheetDragContext);
  return (
    <View
      {...props}
      onStartShouldSetResponderCapture={(event) => {
        gate?.exclude();
        return onStartShouldSetResponderCapture?.(event) ?? false;
      }}
    />
  );
}

const styles = StyleSheet.create({
  surface: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: "88%",
    overflow: "hidden",
  },
  grabberButton: {
    alignSelf: "center",
    width: 88,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
  },
  grabberLocked: { opacity: 0 },
  header: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.md,
  },
  headerWithSides: { paddingHorizontal: Spacing.sm },
  side: { width: 76, justifyContent: "center" },
  sideStart: { alignItems: "flex-start" },
  sideEnd: { alignItems: "flex-end" },
  headerCopy: { flex: 1, minWidth: 0, alignItems: "center", gap: 2 },
  title: { fontSize: FontSize.lg, lineHeight: 22, fontWeight: "600", textAlign: "center" },
  subtitle: { fontSize: FontSize.sm, lineHeight: 17, textAlign: "center" },
  scrollArea: { flexGrow: 1, flexShrink: 1 },
  scrollEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    pointerEvents: "none",
  },
});
