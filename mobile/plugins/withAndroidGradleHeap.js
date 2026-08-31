const { withGradleProperties } = require("@expo/config-plugins");

// The default Gradle daemon heap (2048m) reliably OOMs on this project's
// Jetifier transform of the Hermes AAR — see mobile/README.md "Android
// build notes". expo-build-properties has no generic gradleProperties
// passthrough (only specific known keys), so a small local plugin using
// the underlying withGradleProperties mod is the actual supported way to
// persist this across every `expo prebuild`.
module.exports = function withAndroidGradleHeap(config) {
  return withGradleProperties(config, (config) => {
    const key = "org.gradle.jvmargs";
    const value = "-Xmx4096m -XX:MaxMetaspaceSize=1024m";
    const existing = config.modResults.find((item) => item.type === "property" && item.key === key);
    if (existing) {
      existing.value = value;
    } else {
      config.modResults.push({ type: "property", key, value });
    }
    return config;
  });
};
