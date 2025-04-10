const WebExtensionTarget = require('webextension-toolbox/config/webpack-target-webextension');

module.exports = {
  entry: './src/background.js',
  output: {
    filename: 'background.js',
    path: __dirname + '/dist',
  },
  plugins: [new WebExtensionTarget()],
};
