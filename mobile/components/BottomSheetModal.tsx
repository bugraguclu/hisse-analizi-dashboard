import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { MotionEasing } from "../lib/theme";
import SwipeDismissSheet from "./SwipeDismissSheet";

const NATIVE_DRIVER = Platform.OS !== "web";
const ENTER_MS = 380;
const EXIT_MS = 280;
const DIM_COLOR = "rgba(0, 0, 0, 0.45)";

export interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  sheetStyle?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  swipeEnabled?: boolean;
  avoidKeyboard?: boolean;
  backdropLabel?: string;
  title?: string;
  subtitle?: string;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  onDismiss?: () => void;
}

/**
 * Shared iOS modal bottom sheet (adapted from TusAnkiM's `BottomSheetModal.tsx`).
 *
 * - Keeps the Modal mounted until the slide-out transition finishes (with a timeout fallback so
 *   a dropped native callback can never leave an invisible touch-blocking layer on screen).
 * - Interpolates backdrop opacity directly against sheet travel while pulling down.
 * - Uses `KeyboardAvoidingView` (`padding` on iOS) when `avoidKeyboard` is enabled.
 */
export default function BottomSheetModal({
  visible,
  onClose,
  children,
  sheetStyle,
  containerStyle,
  swipeEnabled = true,
  avoidKeyboard = true,
  backdropLabel = "Paneli kapat",
  title,
  subtitle,
  headerLeft,
  headerRight,
  onDismiss,
}: BottomSheetModalProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [mounted, setMounted] = useState(visible);
  const [travel, setTravel] = useState(windowHeight);
  const position = useRef(new Animated.Value(windowHeight)).current;
  const generation = useRef(0);
  const pulledAway = useRef(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const latest = useRef({ mounted, travel, windowHeight, reduceMotion, onDismiss });
  latest.current = { mounted, travel, windowHeight, reduceMotion, onDismiss };

  useEffect(() => {
    const run = ++generation.current;
    position.stopAnimation();

    if (visible) {
      pulledAway.current = false;
      setMounted(true);
      if (latest.current.reduceMotion) {
        position.setValue(0);
        return undefined;
      }
      Animated.timing(position, {
        toValue: 0,
        duration: ENTER_MS,
        easing: MotionEasing.sheet,
        useNativeDriver: NATIVE_DRIVER,
      }).start();
      return undefined;
    }

    if (!latest.current.mounted) return undefined;

    const finish = () => {
      if (run !== generation.current) return;
      setMounted(false);
      position.setValue(latest.current.windowHeight);
      latest.current.onDismiss?.();
    };

    if (pulledAway.current || latest.current.reduceMotion) {
      finish();
      return undefined;
    }

    const fallback = setTimeout(finish, EXIT_MS + 250);
    Animated.timing(position, {
      toValue: latest.current.travel,
      duration: EXIT_MS,
      easing: MotionEasing.sheet,
      useNativeDriver: NATIVE_DRIVER,
    }).start(() => {
      clearTimeout(fallback);
      finish();
    });

    return () => clearTimeout(fallback);
  }, [position, visible]);

  const handlePulledAway = () => {
    pulledAway.current = true;
    onClose();
  };

  const measureSheet = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const next = Math.ceil(Math.max(height, windowHeight - y));
    if (next > 0 && Math.abs(next - travel) > 1) setTravel(next);
  };

  const backdropOpacity = useMemo(
    () =>
      position.interpolate({
        inputRange: [0, Math.max(travel, 1)],
        outputRange: [1, 0],
        extrapolate: "clamp",
      }),
    [position, travel],
  );

  return (
    <Modal
      visible={mounted}
      transparent
      animationType={reduceMotion ? "fade" : "none"}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, containerStyle, { pointerEvents: visible ? "auto" : "none" }]}
        behavior={avoidKeyboard && Platform.OS === "ios" ? "padding" : undefined}
        enabled={avoidKeyboard}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.dim,
            { opacity: backdropOpacity, pointerEvents: "none" },
          ]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={backdropLabel}
        />
        <SwipeDismissSheet
          active={visible}
          enabled={swipeEnabled}
          position={position}
          onLayout={measureSheet}
          onDismiss={handlePulledAway}
          style={sheetStyle}
          title={title}
          subtitle={subtitle}
          headerLeft={headerLeft}
          headerRight={headerRight}
        >
          {children}
        </SwipeDismissSheet>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "flex-end" },
  dim: { backgroundColor: DIM_COLOR },
});
