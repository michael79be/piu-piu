import Jimp from 'jimp';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const SOURCE_ICON = resolve('icon500.png');
const OUTPUT_DIR = resolve('public/icons');
const MANIFEST_PATH = resolve('public/manifest.webmanifest');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  console.log('Generating PWA icons from icon500.png...');

  if (!existsSync(SOURCE_ICON)) {
    console.error(`Source icon not found: ${SOURCE_ICON}`);
    process.exit(1);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const sourceImage = await Jimp.read(SOURCE_ICON);
  const icons = [];

  for (const size of SIZES) {
    const outputPath = resolve(OUTPUT_DIR, `icon-${size}x${size}.png`);
    const resized = sourceImage.clone().resize(size, size);
    await resized.writeAsync(outputPath);
    console.log(`Generated ${outputPath}`);
    icons.push({
      src: `icons/icon-${size}x${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'maskable any',
    });
  }

  // Also generate apple-touch-icon.png (180x180)
  const appleTouchPath = resolve('public/apple-touch-icon.png');
  const appleTouch = sourceImage.clone().resize(180, 180);
  await appleTouch.writeAsync(appleTouchPath);
  console.log('Generated public/apple-touch-icon.png');

  // Generate manifest.webmanifest
  const manifest = {
    name: 'Piu-Piu',
    short_name: 'Piu-Piu',
    description: 'Decentralized social network - Full client-side, no backend',
    display: 'standalone',
    scope: '/',
    start_url: '/',
    background_color: '#ffffff',
    theme_color: '#448196',
    icons,
  };

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Updated ${MANIFEST_PATH}`);

  console.log('PWA icon generation complete.');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});