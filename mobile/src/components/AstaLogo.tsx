import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";

type Props = {
  size?: number;
  backgroundColor?: string;
};

export function AstaLogo({ size = 64, backgroundColor = "transparent" }: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size, backgroundColor }]}>
      <Svg width={size} height={size} viewBox="0 0 280 180">
        <Path
          d="M9 137 L67 67 L129 157 L79 90 L111 48 L150 99 L184 29 L168 26 L235 0 L218 68 L207 47 L177 82 L220 139 L203 118 L190 132 L149 78 L116 120 L92 87 L129 156 L62 83 L9 157 Z"
          fill="#fffaf2"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
