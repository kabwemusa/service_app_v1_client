module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Required by react-native-reanimated (and moti) — must be last
      'react-native-reanimated/plugin',
    ],
  };
};
