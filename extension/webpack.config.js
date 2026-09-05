const path = require('path')
const webpack = require('webpack')
require('dotenv').config()

module.exports = {
  entry: { app: './src/index.js' },
  output: { path: path.join(__dirname, 'dist'), filename: 'bundle.js' },
  module: {
    rules: [{ test: /\.(js|jsx)$/, exclude: /node_modules/, use: 'babel-loader' }],
  },
  resolve: { extensions: ['.js', '.jsx'] },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.CA_CAP_SERVICE_URL': JSON.stringify(process.env.CA_CAP_SERVICE_URL || ''),
    }),
  ],
  devServer: {
    host: 'localhost',
    port: 8080,
    server: 'https',
    headers: { 'Access-Control-Allow-Origin': '*' },
    devMiddleware: { writeToDisk: true },
  },
  devtool: false,
  performance: { hints: false },
}
