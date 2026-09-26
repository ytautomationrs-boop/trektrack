import React from 'react';
import {Image,StyleSheet,type ImageStyle,type StyleProp} from 'react-native';
const photos:Record<string,any>={steps:require('../../assets/sports/walking.jpg'),walking:require('../../assets/sports/walking.jpg'),running:require('../../assets/pools/coastal-run.jpg'),cycling:require('../../assets/sports/cycling.jpg'),swimming:require('../../assets/sports/swimming.jpg')};
export function SportPhoto({sport,style}:{sport:string;style?:StyleProp<ImageStyle>}){return <Image source={photos[sport]??photos.running} style={[s.photo,style]} resizeMode="cover" accessible={false}/>;}
const s=StyleSheet.create({photo:{width:'100%',height:125,borderRadius:18}});
