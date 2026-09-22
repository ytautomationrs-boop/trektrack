import React from "react";
import { Image, StyleSheet, View } from "react-native";

type Props = {
  size?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
};

export function AstaLogo({ size = 64, width, height, backgroundColor = "transparent" }: Props) {
  const resolvedWidth = width ?? size;
  const resolvedHeight = height ?? size;
  return (
    <View style={[styles.wrap, { width: resolvedWidth, height: resolvedHeight, backgroundColor }]}>
      <Image source={require("../../assets/asta-logo.png")} style={styles.image} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
});
