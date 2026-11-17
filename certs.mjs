import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import os from 'os';

async function copyCerts() {
  const home = os.homedir();
  // source directory where office-addin-dev-certs installs the certs
  const srcDir = join(home, '.office-addin-dev-certs');
  const destDir = resolve('ssl');

  try {
    // ensure the destination folder exists
    await fs.mkdir(destDir, { recursive: true });
    const files = ['localhost.key', 'localhost.crt'];
    for (const file of files) {
      const src = join(srcDir, file);
      const dest = join(destDir, file);
      await fs.copyFile(src, dest);
    }
    console.log('Certificates copied to ssl/');
  } catch (e) {
    console.error('Failed to copy certificates:', e.message);
    process.exit(1);
  }
}

copyCerts();
