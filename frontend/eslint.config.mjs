import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: frontendRoot
});
export default [...compat.extends('next/core-web-vitals', 'next')];
