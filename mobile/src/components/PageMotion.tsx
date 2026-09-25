import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,Platform} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
/** One opacity/translation animation; no timers, blur, or animated list layout. */
export function PageMotion({children}:{children:React.ReactNode}) {
 const progress=useRef(new Animated.Value(1)).current;const [reduced,setReduced]=useState(true);
 useEffect(()=>{void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);return()=>sub.remove();},[]);
 useFocusEffect(useCallback(()=>{if(reduced)return;progress.setValue(0);const motion=Animated.timing(progress,{toValue:1,duration:150,useNativeDriver:Platform.OS!=='web'});motion.start();return()=>motion.stop();},[reduced,progress]));
 return <Animated.View style={{flex:1,opacity:progress.interpolate({inputRange:[0,1],outputRange:[0.9,1]}),transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[5,0]})}]}}>{children}</Animated.View>;
}
