const { getDefaultConfig } = require("expo/metro-config");
const exclusionList = require("metro-config/src/defaults/exclusionList");
const path = require("path");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const config = getDefaultConfig(__dirname);
const appRoot = escapeRegExp(path.resolve(__dirname));

config.maxWorkers = 1;
config.resolver.blockList = exclusionList([
  new RegExp(`${appRoot}/dist/.*`),
  new RegExp(`${appRoot}/ios/.*`),
  new RegExp(`${appRoot}/android/.*`),
  /.* 2\.[tj]sx?$/,
]);

module.exports = config;
