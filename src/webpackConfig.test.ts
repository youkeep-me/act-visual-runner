import webpack from 'webpack';

const createConfig = require('../webpack.webview.config.js') as (
  env: unknown,
  argv: { mode?: string },
) => webpack.Configuration;

function getNodeEnvDefinition(config: webpack.Configuration): string | undefined {
  const plugin = config.plugins?.find((candidate) => candidate instanceof webpack.DefinePlugin);
  if (!plugin) {
    return undefined;
  }

  const definitions = (plugin as webpack.DefinePlugin & {
    definitions?: { 'process.env.NODE_ENV'?: string };
  }).definitions;
  return definitions?.['process.env.NODE_ENV'];
}

describe('webview webpack configuration', () => {
  it('leaves production NODE_ENV to webpack mode', () => {
    const config = createConfig({}, { mode: 'production' });

    expect(config.mode).toBe('production');
    expect(getNodeEnvDefinition(config)).toBeUndefined();
  });

  it('defines development NODE_ENV outside production mode', () => {
    const config = createConfig({}, { mode: 'development' });

    expect(config.mode).toBe('development');
    expect(getNodeEnvDefinition(config)).toBe(JSON.stringify('development'));
  });

  it('defaults to none when webpack does not provide a mode', () => {
    const config = createConfig({}, {});

    expect(config.mode).toBe('none');
    expect(getNodeEnvDefinition(config)).toBe(JSON.stringify('development'));
  });
});
