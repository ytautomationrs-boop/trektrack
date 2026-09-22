import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Polygon } from "react-native-svg";

type Props = {
  size?: number;
  backgroundColor?: string;
};

export function AstaLogo({ size = 64, backgroundColor = "transparent" }: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size, backgroundColor }]}>
      <Svg width={size} height={size} viewBox="0 0 1024 682">
        <Polygon points="70,600 70,520 284,334 336,414" fill="#fffaf2" />
        <Polygon points="284,334 336,414 455,620 398,540" fill="#fffaf2" />
        <Polygon points="398,540 548,150 618,232 460,622" fill="#fffaf2" />
        <Polygon points="548,150 618,232 725,382 752,450" fill="#fffaf2" />
        <Polygon points="650,478 744,386 912,116 972,70 895,320 842,210" fill="#fffaf2" />
        <Polygon points="706,520 778,464 954,612 898,620 780,536 724,590" fill="#fffaf2" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
