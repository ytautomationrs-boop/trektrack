import React from "react";
import { Image, StyleSheet, View } from "react-native";

type Props = {
  size?: number;
  backgroundColor?: string;
};

export function AstaLogo({ size = 64, backgroundColor = "transparent" }: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size, backgroundColor }]}>
      <Image source={require("../../assets/asta-logo.png")} style={styles.image} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
});
