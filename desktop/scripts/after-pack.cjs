// Copies stage/backend/node_modules into <Resources>/backend/node_modules (see electron-builder.yml).
const { cpSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources')
  cpSync(join(__dirname, '..', 'stage', 'backend', 'node_modules'), join(resources, 'backend', 'node_modules'), { recursive: true, verbatimSymlinks: true })
}
