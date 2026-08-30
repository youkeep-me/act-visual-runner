// webpack.webview.config.js — bundle da Webview UI (browser)
'use strict';

const path = require('path');
const webpack = require('webpack');

/** @type {import('webpack').Configuration | ((env: unknown, argv: import('webpack').CliConfigOptions) => import('webpack').Configuration)} */
module.exports = (_, argv) => {
  const mode = argv.mode || 'none';

  return {
    target: 'web',
    mode,
    entry: './src/webview/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist', 'webview'),
      filename: 'webview.js',
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    plugins: mode === 'production'
      ? []
      : [
          // React e outras libs verificam process.env.NODE_ENV que não existe em webviews.
          // DefinePlugin substitui a referência por uma string literal no bundle.
          new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('development'),
          }),
        ],
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader',
              options: { configFile: 'tsconfig.webview.json' },
            },
          ],
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    devtool: 'nosources-source-map',
    performance: { hints: false },
  };
};
