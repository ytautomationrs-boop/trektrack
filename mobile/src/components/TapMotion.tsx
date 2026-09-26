import React,{useEffect,useRef} from 'react';
import {AccessibilityInfo,Animated,Platform,Pressable,type PressableProps} from 'react-native';
let reduceMotion=true;
let observingMotion=false;
function observeMotionPreference(){
 if(observingMotion)return;
 observingMotion=true;
 void AccessibilityInfo.isReduceMotionEnabled().then(value=>{reduceMotion=value;});
 // One listener for the lifetime of the app, shared by all feed buttons.
 AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{reduceMotion=value;});
}
/** Transform-only feedback: never waits for a request or animates list layout. */
export function TapMotion({children,onPressIn,onPressOut,...props}:PressableProps){
 const scale=useRef(new Animated.Value(1)).current;
 useEffect(observeMotionPreference,[]);
 const animate=(toValue:number)=>{if(reduceMotion)return;Animated.spring(scale,{toValue,speed:38,bounciness:4,useNativeDriver:Platform.OS!=='web'}).start();};
 return <Animated.View style={{transform:[{scale}]}}><Pressable {...props} onPressIn={e=>{animate(0.91);onPressIn?.(e);}} onPressOut={e=>{animate(1);onPressOut?.(e);}}>{children}</Pressable></Animated.View>;
}
