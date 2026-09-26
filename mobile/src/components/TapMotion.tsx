import React,{useEffect,useRef} from 'react';
import {AccessibilityInfo,Animated,Platform,Pressable,type PressableProps} from 'react-native';
/** Transform-only feedback: never waits for a request or animates list layout. */
export function TapMotion({children,onPressIn,onPressOut,...props}:PressableProps){
 const scale=useRef(new Animated.Value(1)).current,reduced=useRef(true);
 useEffect(()=>{void AccessibilityInfo.isReduceMotionEnabled().then(v=>{reduced.current=v;});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',v=>{reduced.current=v;});return()=>sub.remove();},[]);
 const animate=(toValue:number)=>{if(reduced.current)return;Animated.spring(scale,{toValue,speed:38,bounciness:4,useNativeDriver:Platform.OS!=='web'}).start();};
 return <Animated.View style={{transform:[{scale}]}}><Pressable {...props} onPressIn={e=>{animate(0.91);onPressIn?.(e);}} onPressOut={e=>{animate(1);onPressOut?.(e);}}>{children}</Pressable></Animated.View>;
}
