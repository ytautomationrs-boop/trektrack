import React from 'react';
import {Image,View} from 'react-native';
/** Supplied ASTA artwork. The header frames the italic wordmark; launch/auth also show the symbol. */
export function AstaLogo({size=96,width,height,backgroundColor='transparent',symbol=false}:{size?:number;width?:number;height?:number;backgroundColor?:string;symbol?:boolean}){
 const w=width??size,markHeight=w*0.2,scale=w/1060;
 return <View accessible accessibilityLabel="ASTA" style={{width:w,height:height??(symbol?w*.92:markHeight),backgroundColor,alignItems:'center',justifyContent:'center',gap:4}}>
  {symbol && <Image source={require('../../assets/brand/asta-symbol-white.png')} resizeMode="contain" style={{width:w,height:w*.66}}/>}
  <View style={{width:w,height:markHeight,overflow:'hidden'}}><Image source={require('../../assets/brand/asta-logo-white.png')} accessibilityIgnoresInvertColors style={{position:'absolute',width:1254*scale,height:1254*scale,left:-95*scale,top:-865*scale}}/></View>
 </View>;
}
